package org.mage.proxy;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Same-origin CORS relay for client-key LLM calls (ported from the
 * LLMage Jetty {@code LLmRelayHandler}: security rules exactly, not the API).
 *
 * <p>Providers without CORS support cannot be called directly from the browser. The browser POSTs
 * to {@code /llm-relay?url=&lt;provider&gt;} — same-origin, so no CORS applies — and this handler
 * echoes the request to the provider and streams the response back with CORS headers added.
 *
 * <p>SECURITY CONTRACT (do not loosen):
 * <ul>
 *   <li>DUMB BYTE RELAY: it never reads, parses, logs or stores the {@code Authorization} header
 *       or any body. The user's key transits in-memory bytes only — never persisted, logged, or
 *       forwarded anywhere else.</li>
 *   <li>Only an explicit request-header allowlist is forwarded (never cookies, never Origin, never
 *       arbitrary client headers).</li>
 *   <li>SSRF: the target must be {@code https}, or {@code http} ONLY for a localhost host; cloud
 *       metadata hosts are blocked; the host must pass the SAME allowlist as the seat endpoints
 *       ({@code Config.getAllowedModelHosts()}).</li>
 *   <li>Body sizes are capped (request 4 MiB, response 16 MiB) and redirects are NOT followed.</li>
 * </ul>
 *
 * <p>Runtime-toggled: this handler is only ever registered by {@link Main} when
 * {@code --llmRelayEnabled} is true; when off the path 404s because nothing registers it.
 */
final class LlmRelay {

    /** Request headers relayed to the provider — nothing else crosses. */
    static final Set<String> FORWARDED_REQUEST_HEADERS = new HashSet<>(Arrays.asList(
            "authorization", "content-type", "accept", "x-api-key",
            "anthropic-version", "anthropic-dangerous-direct-browser-access",
            "x-opencode-session"));

    static final int MAX_REQUEST_BYTES = 4 * 1024 * 1024;   // 4 MiB cap
    static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // 16 MiB cap
    static final int CONNECT_TIMEOUT_MS = 30_000;
    static final int READ_TIMEOUT_MS = 600_000;

    /** Hosts that are treated as "local" and therefore allowed over plain http. */
    private static final Set<String> LOCAL_HOSTS = new HashSet<>(Arrays.asList(
            "localhost", "127.0.0.1", "::1", "0.0.0.0"));

    /** Cloud metadata endpoints, always blocked. */
    private static final Set<String> METADATA_HOSTS = new HashSet<>(Arrays.asList(
            "169.254.169.254", "169.254.170.2", "metadata.google.internal"));

    private LlmRelay() {
    }

    /**
     * Builds the relay handler bound to the caller's allowed-hosts set (never a static), so the
     * allowlist is the same one the seat endpoints use and is unit-testable.
     */
    static HttpHandler handler(Set<String> allowedModelHosts) {
        return exchange -> handle(exchange, allowedModelHosts);
    }

    private static void handle(HttpExchange exchange, Set<String> allowedModelHosts) throws IOException {
        String method = exchange.getRequestMethod();
        boolean isGet = "GET".equalsIgnoreCase(method);
        boolean isPost = "POST".equalsIgnoreCase(method);
        boolean isOptions = "OPTIONS".equalsIgnoreCase(method);
        if (!isGet && !isPost && !isOptions) {
            respond(exchange, 405, null, "method not allowed");
            return;
        }

        // CORS preflight — answered without touching the provider.
        if (isOptions) {
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            exchange.getResponseHeaders().add("Access-Control-Allow-Headers",
                    "authorization, content-type, accept, x-opencode-session");
            exchange.getResponseHeaders().add("Access-Control-Max-Age", "600");
            respond(exchange, 200, null, "");
            return;
        }

        String targetUrl = extractUrl(exchange.getRequestURI().getRawQuery());
        if (targetUrl == null || targetUrl.isEmpty()) {
            respond(exchange, 400, "text/plain; charset=utf-8", "missing url query parameter");
            return;
        }

        // SSRF gate — same policy as fetch_models / seat endpoints.
        URL url;
        try {
            url = new URL(targetUrl);
        } catch (java.net.MalformedURLException ex) {
            respond(exchange, 400, "text/plain; charset=utf-8", "malformed url: " + ex.getMessage());
            return;
        }
        String rejection = rejectionReason(url, allowedModelHosts);
        if (rejection != null) {
            respond(exchange, 403, "text/plain; charset=utf-8", rejection);
            return;
        }

        // Relay the call, byte-for-byte, headers from the allowlist only. GET carries no body
        // (model-list fetches); POST relays the request body.
        try {
            byte[] body = isGet ? new byte[0] : readRequestCapped(exchange.getRequestBody());
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method.toUpperCase(java.util.Locale.ROOT));
            for (String name : FORWARDED_REQUEST_HEADERS) {
                String value = exchange.getRequestHeaders().getFirst(name);
                if (value != null && !value.isEmpty()) {
                    conn.setRequestProperty(name, value);
                }
            }
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            if (!isGet) {
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
            }

            int status = conn.getResponseCode();
            InputStream is = (status >= 200 && status < 300) ? conn.getInputStream() : conn.getErrorStream();
            byte[] respBody = is != null ? readResponseCapped(is) : new byte[0];
            // Status + CORS header + upstream content-type (default application/json) + body.
            String contentType = conn.getContentType();
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            respond(exchange, status, contentType != null ? contentType : "application/json",
                    new String(respBody, StandardCharsets.UTF_8));
        } catch (IOException ex) {
            respond(exchange, 502, "text/plain; charset=utf-8", "relay upstream failure: " + ex.getMessage());
        }
    }

    /**
     * The SSRF policy in one place: {@code null} when the target is allowed, else the 403 reason.
     * Shared with {@link #handler}; kept package-private so the rules can be asserted directly.
     */
    static String rejectionReason(URL url, Set<String> allowedModelHosts) {
        String host = url.getHost();
        String bareHost = host;
        if (bareHost != null && bareHost.length() > 1 && bareHost.startsWith("[") && bareHost.endsWith("]")) {
            bareHost = bareHost.substring(1, bareHost.length() - 1);
        }
        boolean localHost = bareHost != null && LOCAL_HOSTS.contains(bareHost);
        String protocol = url.getProtocol();
        if (!"https".equalsIgnoreCase(protocol) && !("http".equalsIgnoreCase(protocol) && localHost)) {
            // Remote targets must be https: relayed bodies carry the user's provider key, which
            // must never cross the wire in cleartext. Plain http stays allowed for local
            // Ollama-style endpoints only.
            return "remote relay targets must be https (http is only allowed for localhost)";
        }
        if (bareHost != null && METADATA_HOSTS.contains(bareHost.toLowerCase(java.util.Locale.ROOT))) {
            return "cloud metadata endpoints blocked";
        }
        boolean allowed = false;
        if (allowedModelHosts != null && bareHost != null) {
            for (String h : allowedModelHosts) {
                if (h.equalsIgnoreCase(bareHost)) {
                    allowed = true;
                    break;
                }
            }
        }
        if (!allowed) {
            return "target host not in model-endpoint allowlist (--allowedModelHosts)";
        }
        return null;
    }

    /** The {@code url} value of a raw query string, URL-decoded, or {@code null} when absent. */
    static String extractUrl(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            return null;
        }
        for (String pair : rawQuery.split("&")) {
            if (pair.startsWith("url=")) {
                try {
                    return URLDecoder.decode(pair.substring(4), "UTF-8");
                } catch (Exception ex) {
                    return pair.substring(4);
                }
            }
        }
        return null;
    }

    private static byte[] readRequestCapped(InputStream in) throws IOException {
        try (ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > MAX_REQUEST_BYTES) {
                    throw new IOException("body exceeds relay cap (" + MAX_REQUEST_BYTES + " bytes)");
                }
            }
            return bos.toByteArray();
        }
    }

    private static byte[] readResponseCapped(InputStream in) throws IOException {
        try (ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > MAX_RESPONSE_BYTES) {
                    throw new IOException("upstream response exceeds relay cap (" + MAX_RESPONSE_BYTES + " bytes)");
                }
            }
            return bos.toByteArray();
        }
    }

    /** Writes a full response: status, content-type (when given), body. Empty body = length 0. */
    private static void respond(HttpExchange exchange, int status, String contentType, String body)
            throws IOException {
        byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        if (contentType != null) {
            exchange.getResponseHeaders().add("Content-Type", contentType);
        }
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        } finally {
            exchange.close();
        }
    }
}
