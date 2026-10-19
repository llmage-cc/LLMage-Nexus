package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * The model/personality list verbs of the per-seat LLM config UI.
 *
 * <ul>
 *   <li>{@code fetchModels {apiEndpoint}} — lists the models an OpenAI-compatible endpoint
 *       serves, so the seat form shows a dropdown instead of a free-text field. The network
 *       call runs on a bounded background pool: {@code handle} is reached from the session's
 *       only server-facing thread, and one slow provider must not stall every other action of
 *       the session.</li>
 *   <li>{@code fetchPersonalities {}} — the engine's personality registry (pure in-memory, no
 *       network, answered inline).</li>
 * </ul>
 *
 * <p>Both are gated FIRST on {@code capabilities.llm}: against a server that cannot run LLM
 * seats, the list is meaningless and the reply is the typed {@code CAPABILITY_UNAVAILABLE}
 * before any work. Endpoint validation reuses the exact {@code llmConfigs} policy
 * ({@link LlmConfigs#validateModelEndpoint}: http/https only, cloud-metadata hosts blocked,
 * host on the {@code --allowedModelHosts} allowlist) BEFORE any network call.
 *
 * <p>Every failure answers a TYPED frame — {@code models_error} / {@code personalities_error}
 * carrying {@code errorCode} — never the generic {@code error} frame: the web consumer clears
 * its loading flag only on the typed reply, and a generic error would leave it spinning
 * forever. Success answers a normal
 * {@code result} envelope carrying {@code data.models} / {@code data.personalities}.
 */
final class LlmModelCommands {

    private LlmModelCommands() {
    }

    static final String MODELS_ERROR_FRAME = "models_error";
    static final String PERSONALITIES_ERROR_FRAME = "personalities_error";

    private static final int MODEL_FETCH_TIMEOUT_MS = 5000;
    private static final int MODEL_FETCH_MAX_BYTES = 256 * 1024;

    /**
     * The fetch runs here, off the session's only server-facing thread (same reasoning as
     * {@link OnlineDeckCommands}): a provider that hangs for the connect timeout would otherwise
     * freeze every other action of that session. Bounded on purpose — a full queue answers a
     * typed error instead of growing an unbounded backlog of open sockets.
     */
    private static final ThreadPoolExecutor FETCHES = new ThreadPoolExecutor(
            2, 4, 30L, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8),
            r -> {
                Thread t = new Thread(r, "llm-model-fetch");
                t.setDaemon(true);
                return t;
            },
            new ThreadPoolExecutor.AbortPolicy());

    static boolean handle(String action, WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        switch (action) {
            case "fetchModels": {
                if (CapabilityGate.rejectLlmListWithoutCapability(ctx, conn, action, requestId,
                        MODELS_ERROR_FRAME)) {
                    return true;
                }
                handleFetchModels(conn, requestId, args, ctx);
                return true;
            }
            case "fetchPersonalities": {
                if (CapabilityGate.rejectLlmListWithoutCapability(ctx, conn, action, requestId,
                        PERSONALITIES_ERROR_FRAME)) {
                    return true;
                }
                handleFetchPersonalities(conn, requestId, ctx);
                return true;
            }
            default:
                return false;
        }
    }

    /** Open prompts answered by the list verbs once a session had model fetches in flight. */
    static int inFlight() {
        return FETCHES.getActiveCount() + FETCHES.getQueue().size();
    }

    private static void handleFetchModels(WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        String endpoint = JsonArgs.str(args, "apiEndpoint", "").trim();
        if (endpoint.isEmpty()) {
            // No endpoint in this seat: it uses the server's configured default, which this proxy
            // does NOT know. Never substitute a fabricated localhost endpoint and dial it — the
            // allowlist would reject it while naming the wrong host. Say plainly that there is
            // nothing to list from here.
            sendError(ctx, conn, "fetchModels", requestId, ProxyProtocol.ERR_INVALID_ARGUMENT,
                    "This seat has no model endpoint set — it uses the server's configured default. "
                            + "Set a Provider/endpoint to list its models here.");
            return;
        }
        Set<String> allowedModelHosts = ctx.gateway().getConfig().getAllowedModelHosts();
        final String validated;
        try {
            validated = LlmConfigs.validateModelEndpoint(endpoint, allowedModelHosts);
        } catch (IllegalArgumentException ex) {
            // Same endpoint policy as createTable, applied BEFORE any network call. The operator
            // flag name is stripped from the player-facing frame (it renders in the seat form) and
            // the host is kept — it is the actionable part.
            sendError(ctx, conn, "fetchModels", requestId, ProxyProtocol.ERR_INVALID_ARGUMENT,
                    playerMessage(ex.getMessage()));
            return;
        }
        try {
            FETCHES.execute(() -> answerModels(conn, requestId, validated, ctx));
        } catch (RejectedExecutionException ex) {
            sendError(ctx, conn, "fetchModels", requestId, ProxyProtocol.ERR_FAILED,
                    "too many model fetches in flight, try again in a moment");
        }
    }

    private static void answerModels(WebSocket conn, String requestId, String endpoint, CommandContext ctx) {
        try {
            List<String> models = fetchModelsFromEndpoint(endpoint);
            if (models.isEmpty()) {
                sendError(ctx, conn, "fetchModels", requestId, ProxyProtocol.ERR_FAILED,
                        "No models found at endpoint");
                return;
            }
            JsonObject data = new JsonObject();
            JsonArray arr = new JsonArray();
            for (String m : models) {
                arr.add(m);
            }
            data.add("models", arr);
            data.addProperty("endpoint", endpoint);
            ctx.gateway().send(conn, ProxyProtocol.resultJson("fetchModels", requestId, true, null, data));
        } catch (Exception ex) {
            sendError(ctx, conn, "fetchModels", requestId, ProxyProtocol.ERR_FAILED, readable(ex));
        }
    }

    private static void handleFetchPersonalities(WebSocket conn, String requestId, CommandContext ctx) {
        try {
            // Pure in-memory registry read (no provider call): answered inline.
            List<String> names = mage.players.Personality.allNames();
            JsonObject data = new JsonObject();
            JsonArray arr = new JsonArray();
            if (names != null) {
                for (String n : names) {
                    arr.add(n);
                }
            }
            data.add("personalities", arr);
            ctx.gateway().send(conn, ProxyProtocol.resultJson("fetchPersonalities", requestId, true, null, data));
        } catch (Throwable ex) {
            sendError(ctx, conn, "fetchPersonalities", requestId, ProxyProtocol.ERR_FAILED, readable(ex));
        }
    }

    // ── Endpoint call (mirrors the web client's fetchModelsFromEndpoint) ──

    /**
     * Lists the models an endpoint serves. Derives the base URL from the chat-completions URL,
     * tries Ollama's {@code /api/tags} when the endpoint looks like Ollama, then falls back to
     * the OpenAI-compatible {@code /v1/models} (parsing {@code data[].id}).
     */
    static List<String> fetchModelsFromEndpoint(String endpoint) throws Exception {
        String baseUrl = baseUrlOf(endpoint);
        if (looksLikeOllama(endpoint)) {
            List<String> ollama = parseIdList(httpGet(baseUrl + "/api/tags"), "models", "name");
            if (!ollama.isEmpty()) {
                return ollama;
            }
        }
        return parseIdList(httpGet(baseUrl + "/v1/models"), "data", "id");
    }

    /** Base URL of a chat-completions endpoint: strips a trailing {@code /v1/chat/completions}, {@code /v1} or slash. */
    static String baseUrlOf(String endpoint) {
        String s = endpoint.trim();
        if (s.endsWith("/v1/chat/completions")) {
            return s.substring(0, s.length() - "/v1/chat/completions".length());
        }
        if (s.endsWith("/v1")) {
            return s.substring(0, s.length() - "/v1".length());
        }
        if (s.endsWith("/")) {
            return s.substring(0, s.length() - 1);
        }
        return s;
    }

    static boolean looksLikeOllama(String endpoint) {
        String e = endpoint == null ? "" : endpoint.toLowerCase(Locale.ROOT);
        return e.contains("ollama") || e.contains("11434");
    }

    /** Parses {@code root[arrayKey][].idKey} into a string list; a non-object body yields an empty list. */
    static List<String> parseIdList(String body, String arrayKey, String idKey) {
        List<String> out = new ArrayList<>();
        JsonElement parsed;
        try {
            parsed = com.google.gson.JsonParser.parseString(body);
        } catch (RuntimeException ex) {
            throw new IllegalStateException("endpoint did not return valid JSON");
        }
        if (parsed == null || !parsed.isJsonObject()) {
            return out;
        }
        JsonObject root = parsed.getAsJsonObject();
        if (!root.has(arrayKey) || !root.get(arrayKey).isJsonArray()) {
            return out;
        }
        for (JsonElement el : root.getAsJsonArray(arrayKey)) {
            if (el == null || !el.isJsonObject()) {
                continue;
            }
            JsonObject item = el.getAsJsonObject();
            if (item.has(idKey) && item.get(idKey).isJsonPrimitive()) {
                out.add(item.get(idKey).getAsString());
            }
        }
        return out;
    }

    /**
     * GET the model-list URL. Redirects are NOT followed (a Location target was never validated
     * against the allowlist), the body is capped and both timeouts are bounded.
     */
    private static String httpGet(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(MODEL_FETCH_TIMEOUT_MS);
            conn.setReadTimeout(MODEL_FETCH_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            int status = conn.getResponseCode();
            if (status >= 300 && status < 400) {
                throw new IllegalStateException("endpoint returned redirect HTTP " + status
                        + " — redirects are not followed for model fetching");
            }
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("endpoint returned HTTP " + status);
            }
            return readLimited(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static String readLimited(InputStream in) throws Exception {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int total = 0;
            int n;
            while ((n = reader.read(buf)) != -1) {
                total += n;
                if (total > MODEL_FETCH_MAX_BYTES) {
                    throw new IllegalStateException("model list response exceeds "
                            + MODEL_FETCH_MAX_BYTES + " bytes — aborting");
                }
                sb.append(buf, 0, n);
            }
            return sb.toString();
        }
    }

    // ── Frame helpers ──

    private static void sendError(CommandContext ctx, WebSocket conn, String action, String requestId,
                                  String errorCode, String message) {
        String frame = "fetchPersonalities".equals(action) ? PERSONALITIES_ERROR_FRAME : MODELS_ERROR_FRAME;
        ctx.gateway().send(conn, ProxyProtocol.typedErrorJson(frame, action, requestId, errorCode, message));
    }

    /** Player-facing text: drops the operator flag name (it renders in the seat form). */
    static String playerMessage(String raw) {
        return raw == null ? "Model list unavailable" : raw.replace(" (--allowedModelHosts)", "");
    }

    private static String readable(Throwable ex) {
        String msg = ex.getMessage();
        if (msg == null || msg.trim().isEmpty()) {
            return ex.getClass().getSimpleName();
        }
        return msg;
    }
}
