package org.mage.proxy;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The runtime-toggled {@code /llm-relay} route. Runs entirely on
 * {@code 127.0.0.1} — a local stub provider stands in for the real one — so the byte echo (status,
 * content-type, body, CORS header) and every rejection (http-remote, metadata host, host not in the
 * allowlist, missing URL, redirects not followed) are asserted with no internet access.
 */
class LlmRelayTest {

    private HttpServer relay;
    private HttpServer upstream;
    private int relayPort;
    private int upstreamPort;

    private void startRelay(java.util.Set<String> allowed) throws Exception {
        relay = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        relay.createContext("/llm-relay", LlmRelay.handler(allowed));
        relay.start();
        relayPort = relay.getAddress().getPort();
    }

    private void startUpstream(com.sun.net.httpserver.HttpHandler handler) throws Exception {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/v1/chat/completions", handler);
        upstream.start();
        upstreamPort = upstream.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        if (relay != null) {
            relay.stop(0);
        }
        if (upstream != null) {
            upstream.stop(0);
        }
    }

    private static String relayUrl(int port, String target) {
        return "http://127.0.0.1:" + port + "/llm-relay?url="
                + URLEncoder.encode(target, StandardCharsets.UTF_8);
    }

    private static final class Response {
        int status;
        String body;
        Map<String, List<String>> headers;

        /** Case-insensitive header lookup (the JDK server is not consistent about header case). */
        List<String> header(String name) {
            if (headers == null) {
                return null;
            }
            for (Map.Entry<String, List<String>> e : headers.entrySet()) {
                if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) {
                    return e.getValue();
                }
            }
            return null;
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while (in != null && (n = in.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private static Response call(String url, String method, String body, String[][] headers) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestMethod(method);
        if (headers != null) {
            for (String[] h : headers) {
                conn.setRequestProperty(h[0], h[1]);
            }
        }
        if (body != null) {
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        Response r = new Response();
        r.status = conn.getResponseCode();
        r.headers = conn.getHeaderFields();
        InputStream in = (r.status >= 200 && r.status < 300) ? conn.getInputStream() : conn.getErrorStream();
        if (in != null) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            r.body = new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
        return r;
    }

    // ── byte echo ──

    @Test
    void relaysRequestBytesAndEchoesStatusContentTypeAndCors() throws Exception {
        AtomicReference<String> seenAuth = new AtomicReference<>();
        AtomicReference<String> seenCookie = new AtomicReference<>();
        AtomicReference<String> seenBody = new AtomicReference<>();
        startUpstream(ex -> {
            seenAuth.set(ex.getRequestHeaders().getFirst("Authorization"));
            seenCookie.set(ex.getRequestHeaders().getFirst("Cookie"));
            byte[] body = readAll(ex.getRequestBody());
            seenBody.set(new String(body, StandardCharsets.UTF_8));
            ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            byte[] out = "{\"choices\":[{\"text\":\"hi\"}]}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, out.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(out);
            }
        });
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());

        String target = "http://127.0.0.1:" + upstreamPort + "/v1/chat/completions";
        Response r = call(relayUrl(relayPort, target), "POST", "{\"model\":\"m\"}",
                new String[][]{{"Authorization", "Bearer SECRET"}, {"Content-Type", "application/json"},
                        {"Cookie", "session=abc"}, {"X-OpenCode-Session", "sess-1"}});

        assertEquals(200, r.status);
        assertEquals("{\"choices\":[{\"text\":\"hi\"}]}", r.body);
        assertNotNull(r.header("Content-Type"));
        assertTrue(r.header("Content-Type").get(0).startsWith("application/json"));
        assertEquals(java.util.Arrays.asList("*"), r.header("Access-Control-Allow-Origin"));
        // dumb byte relay: the allowlisted Authorization crossed, the non-allowlisted Cookie did not
        assertEquals("Bearer SECRET", seenAuth.get());
        assertNull(seenCookie.get(), "cookies must never be forwarded");
        assertEquals("{\"model\":\"m\"}", seenBody.get());
    }

    @Test
    void getWithNoBodyRelaysAndCarriesAJsonContentType() throws Exception {
        startUpstream(ex -> {
            byte[] out = "{\"data\":[]}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, out.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(out);
            }
        });
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        String target = "http://127.0.0.1:" + upstreamPort + "/v1/chat/completions";
        Response r = call(relayUrl(relayPort, target), "GET", null, null);
        assertEquals(200, r.status);
        assertEquals("{\"data\":[]}", r.body);
        assertNotNull(r.header("Content-Type"));
        assertTrue(r.header("Content-Type").get(0).startsWith("application/json"),
                "a JSON-ish content-type reaches the browser: " + r.header("Content-Type"));
    }

    @Test
    void doesNotFollowRedirects() throws Exception {
        startUpstream(ex -> {
            ex.getResponseHeaders().add("Location", "http://169.254.169.254/");
            ex.sendResponseHeaders(302, -1);
            ex.close();
        });
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        String target = "http://127.0.0.1:" + upstreamPort + "/v1/chat/completions";
        Response r = call(relayUrl(relayPort, target), "GET", null, null);
        assertEquals(302, r.status, "a redirect is passed through, never followed");
    }

    // ── CORS preflight ──

    @Test
    void optionsPreflightAnswers200WithCorsHeadersAndEmptyBody() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call("http://127.0.0.1:" + relayPort + "/llm-relay", "OPTIONS", null, null);
        assertEquals(200, r.status);
        assertEquals(java.util.Arrays.asList("*"), r.header("Access-Control-Allow-Origin"));
        assertEquals(java.util.Arrays.asList("POST, GET, OPTIONS"),
                r.header("Access-Control-Allow-Methods"));
        assertEquals(java.util.Arrays.asList("authorization, content-type, accept, x-opencode-session"),
                r.header("Access-Control-Allow-Headers"));
        assertEquals(java.util.Arrays.asList("600"), r.header("Access-Control-Max-Age"));
        assertTrue(r.body == null || r.body.isEmpty());
    }

    // ── rejections ──

    @Test
    void missingUrlIs400() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call("http://127.0.0.1:" + relayPort + "/llm-relay", "POST", "{}", null);
        assertEquals(400, r.status);
        assertTrue(r.body.contains("missing url"));
    }

    @Test
    void malformedUrlIs400() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call(relayUrl(relayPort, "not a url"), "POST", "{}", null);
        assertEquals(400, r.status);
    }

    @Test
    void remoteHttpTargetIs403() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call(relayUrl(relayPort, "http://example.com/v1/chat/completions"), "POST", "{}", null);
        assertEquals(403, r.status);
        assertTrue(r.body.contains("https"), r.body);
    }

    @Test
    void cloudMetadataHostIs403() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        for (String host : new String[]{"169.254.169.254", "169.254.170.2", "metadata.google.internal"}) {
            Response r = call(relayUrl(relayPort, "https://" + host + "/latest/meta-data/"), "GET", null, null);
            assertEquals(403, r.status, host);
            assertTrue(r.body.contains("cloud metadata"), r.body);
        }
    }

    @Test
    void hostNotInTheAllowlistIs403() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call(relayUrl(relayPort, "https://api.openai.com/v1/chat/completions"), "POST", "{}", null);
        assertEquals(403, r.status);
        assertTrue(r.body.contains("allowlist"), r.body);
    }

    @Test
    void unsupportedMethodIs405() throws Exception {
        startRelay(Config.parse(new String[0]).getAllowedModelHosts());
        Response r = call("http://127.0.0.1:" + relayPort + "/llm-relay", "PUT", null, null);
        assertEquals(405, r.status);
    }

    // ── policy unit-level (no sockets) ──

    @Test
    void theRelayPolicyAllowsLocalHttpAndAllowlistedHttpsOnly() throws Exception {
        java.util.Set<String> allowed = Config.parse(new String[]{
                "--allowedModelHosts", "localhost,127.0.0.1,::1,api.openai.com"}).getAllowedModelHosts();
        assertNull(LlmRelay.rejectionReason(new URL("http://127.0.0.1:11434/v1"), allowed));
        assertNull(LlmRelay.rejectionReason(new URL("https://api.openai.com/v1"), allowed));
        assertNotNull(LlmRelay.rejectionReason(new URL("http://api.openai.com/v1"), allowed), "remote http");
        assertNotNull(LlmRelay.rejectionReason(new URL("https://metadata.google.internal/x"), allowed));
        assertNotNull(LlmRelay.rejectionReason(new URL("https://evil.example.com/v1"), allowed));
        assertNotNull(LlmRelay.rejectionReason(new URL("https://openrouter.ai/api"), allowed));
    }

    @Test
    void extractUrlDecodesAndHandlesAbsence() {
        assertEquals("https://x.test/a?b=1", LlmRelay.extractUrl("url=https%3A%2F%2Fx.test%2Fa%3Fb%3D1"));
        assertNull(LlmRelay.extractUrl(null));
        assertNull(LlmRelay.extractUrl("other=1"));
    }

    @Test
    void aToggleOffMeansNoContextIsRegistered() throws Exception {
        // the route object itself is only created by Main when the knob is on; simulate the "off"
        // world by an HTTP server that never registers the context → the path must 404
        HttpServer bare = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        bare.start();
        try {
            Response r = call("http://127.0.0.1:" + bare.getAddress().getPort() + "/llm-relay", "GET", null, null);
            assertEquals(404, r.status);
        } finally {
            bare.stop(0);
        }
        assertFalse(Config.parse(new String[0]).isLlmRelayEnabled(), "relay defaults OFF");
        assertTrue(Config.parse(new String[]{"--llmRelayEnabled", "true"}).isLlmRelayEnabled());
        assertFalse(Config.parse(new String[]{"--llmRelayEnabled", "false"}).isLlmRelayEnabled());
    }
}
