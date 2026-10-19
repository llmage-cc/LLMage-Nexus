package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpPrincipal;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code GET /config} is ALWAYS served (never admin-gated), {@code no-store}, and
 * answers the frozen body for every flag combination.
 */
class MainConfigRouteTest {

    /** Minimal HttpExchange double capturing status, headers and body. */
    static final class FakeExchange extends HttpExchange {
        private final Headers responseHeaders = new Headers();
        private final ByteArrayOutputStream body = new ByteArrayOutputStream();
        private final String method;
        private int status = -1;
        private boolean closed;

        FakeExchange(String method) {
            this.method = method;
        }

        @Override
        public Headers getRequestHeaders() {
            return new Headers();
        }

        @Override
        public Headers getResponseHeaders() {
            return responseHeaders;
        }

        @Override
        public URI getRequestURI() {
            return URI.create("http://localhost:8788/config");
        }

        @Override
        public String getRequestMethod() {
            return method;
        }

        @Override
        public HttpContext getHttpContext() {
            return null;
        }

        @Override
        public void close() {
            closed = true;
        }

        @Override
        public InputStream getRequestBody() {
            return new ByteArrayInputStream(new byte[0]);
        }

        @Override
        public OutputStream getResponseBody() {
            return body;
        }

        @Override
        public void sendResponseHeaders(int rCode, long responseLength) {
            this.status = rCode;
        }

        @Override
        public InetSocketAddress getRemoteAddress() {
            return new InetSocketAddress("127.0.0.1", 12345);
        }

        @Override
        public int getResponseCode() {
            return status;
        }

        @Override
        public InetSocketAddress getLocalAddress() {
            return new InetSocketAddress("127.0.0.1", 8788);
        }

        @Override
        public String getProtocol() {
            return "HTTP/1.1";
        }

        @Override
        public Object getAttribute(String name) {
            return null;
        }

        @Override
        public void setAttribute(String name, Object value) {
        }

        @Override
        public void setStreams(InputStream i, OutputStream o) {
        }

        @Override
        public HttpPrincipal getPrincipal() {
            return null;
        }

        String bodyString() {
            return new String(body.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static DeploymentConfig cfg(String... args) {
        return DeploymentConfig.from(Config.parse(args), null);
    }

    private static JsonObject fetch(DeploymentConfig deployment) {
        FakeExchange ex = new FakeExchange("GET");
        Main.serveConfig(ex, deployment);
        assertEquals(200, ex.getResponseCode());
        assertEquals("no-store", ex.getResponseHeaders().getFirst("Cache-Control"));
        assertTrue(ex.getResponseHeaders().getFirst("Content-Type").startsWith("application/json"));
        return JsonParser.parseString(ex.bodyString()).getAsJsonObject();
    }

    @Test
    void theRouteIsAlwaysServedWithEveryFlagCombination() {
        JsonObject defaults = fetch(cfg());
        assertFalse(defaults.get("authRequired").getAsBoolean());
        assertTrue(defaults.get("pinnedTarget").isJsonNull());

        JsonObject full = fetch(cfg("--authToken", "t", "--hideServerTarget", "true",
                "--pinnedXmageTarget", "beta.example:17181", "--deploymentName", "Acme",
                "--llmRelayEnabled", "true"));
        assertTrue(full.get("authRequired").getAsBoolean());
        assertTrue(full.get("hideServerTarget").getAsBoolean());
        assertEquals("beta.example:17181", full.get("pinnedTarget").getAsString());
        assertEquals("Acme", full.get("deploymentName").getAsString());
        assertTrue(full.get("llmRelay").getAsBoolean());
    }

    @Test
    void aNonGetRequestIsRejected() {
        FakeExchange ex = new FakeExchange("POST");
        Main.serveConfig(ex, cfg());
        assertEquals(405, ex.getResponseCode());
    }

    @Test
    void noCacheControlHeaderIsEverMissing() {
        // a restarted proxy's new config must never be served stale from a browser cache
        FakeExchange ex = new FakeExchange("GET");
        Main.serveConfig(ex, cfg("--authToken", "x"));
        assertEquals("no-store", ex.getResponseHeaders().getFirst("Cache-Control"));
    }
}
