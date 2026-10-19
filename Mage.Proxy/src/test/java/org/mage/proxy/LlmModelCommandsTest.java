package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The {@code fetchModels} / {@code fetchPersonalities} list verbs — the
 * capability gate FIRST (typed frame, no work), the endpoint validation on the models path
 * (reusing the llmConfigs policy) BEFORE any network call, the OpenAI {@code data[].id} parse,
 * and the rule that a failure is ALWAYS a typed {@code models_error} / {@code personalities_error}
 * frame, never the generic {@code error} (the frontend loading-flag pitfall).
 */
class LlmModelCommandsTest {

    private static final List<String> SEAT_ORDER = Arrays.asList("HUMAN", "COMPUTER_LLM");

    private static JsonObject args(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    static final class CapturingGateway extends Gateway {
        final List<String> sent = new ArrayList<>();

        CapturingGateway() {
            super(Config.parse(new String[]{
                    "--wsPort", "0", "--simRoster", "none",
                    "--allowedModelHosts", "localhost,127.0.0.1,::1"}));
        }

        @Override
        public void send(WebSocket conn, String json) {
            synchronized (sent) {
                sent.add(json);
            }
        }

        List<String> snapshot() {
            synchronized (sent) {
                return new ArrayList<>(sent);
            }
        }
    }

    /** Stub context whose capabilities are configurable per test. */
    static final class StubCtx implements CommandContext {

        @Override
        public boolean simEnabled() {
            return true;
        }
        final StubSession session = new StubSession();
        final CapturingGateway gateway = new CapturingGateway();
        private ServerCapabilities caps = ServerCapabilities.none();

        void setCaps(ServerCapabilities caps) {
            this.caps = caps;
        }

        static ServerCapabilities llmServer() {
            return ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1", SEAT_ORDER);
        }

        @Override
        public SessionImpl session() {
            return session;
        }

        @Override
        public Gateway gateway() {
            return gateway;
        }

        @Override
        public boolean isConnected() {
            return true;
        }

        @Override
        public ServerCapabilities capabilities() {
            return caps;
        }

        @Override
        public boolean replayActive() {
            return false;
        }

        @Override
        public int replayStateCount() {
            return -1;
        }

        @Override
        public boolean liveGameActive() {
            return false;
        }

        @Override
        public void markReplayActive(UUID gameId) {
        }

        @Override
        public void clearReplay() {
        }

        @Override
        public void sendFailure(WebSocket conn, String action, String requestId, long start) {
        }

        @Override
        public void replayGameState(WebSocket conn, UUID gameId) {
        }

        @Override
        public void markGameActive(UUID gameId) {
        }

        @Override
        public void markGameInactive(UUID gameId) {
        }

        @Override
        public ReplayCache.Prompt takePrompt(UUID gameId, boolean onlySelect) {
            return null;
        }

        @Override
        public void restorePrompt(UUID gameId, ReplayCache.Prompt prompt) {
        }

        @Override
        public void startSims(JsonObject args, UUID roomId, UUID tableId) {
        }
    }

    static final class StubSession extends SessionImpl {
        StubSession() {
            super(null);
        }
    }

    private static JsonObject lastFrame(StubCtx ctx) {
        List<String> sent = ctx.gateway.snapshot();
        assertFalse(sent.isEmpty(), "a frame must have been sent");
        return JsonParser.parseString(sent.get(sent.size() - 1)).getAsJsonObject();
    }

    private static JsonObject awaitFrame(StubCtx ctx, String type) throws Exception {
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            for (String raw : ctx.gateway.snapshot()) {
                JsonObject o = JsonParser.parseString(raw).getAsJsonObject();
                if (type.equals(o.get("type").getAsString())) {
                    return o;
                }
            }
            Thread.sleep(20);
        }
        throw new AssertionError("no " + type + " frame within 5s; sent=" + ctx.gateway.snapshot());
    }

    // ── Capability gate: typed frame FIRST, no work ──

    @Test
    void fetchModelsOnAStockServerIsRejectedTypedNeverGeneric() throws Exception {
        StubCtx ctx = new StubCtx();
        LlmModelCommands.handle("fetchModels", null, "m1",
                args("{\"apiEndpoint\":\"http://localhost:11434/v1/chat/completions\"}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals(LlmModelCommands.MODELS_ERROR_FRAME, res.get("type").getAsString());
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertTrue(res.get("message").getAsString().contains("does not support LLM"),
                res.get("message").getAsString());
        assertEquals(0, LlmModelCommands.inFlight(), "no network fetch may start behind the gate");
    }

    @Test
    void fetchPersonalitiesOnAStockServerIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        LlmModelCommands.handle("fetchPersonalities", null, "p1", args("{}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals(LlmModelCommands.PERSONALITIES_ERROR_FRAME, res.get("type").getAsString());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
    }

    @Test
    void theGateFrameEchoesRequestIdAndNeverUsesTheGenericErrorType() throws Exception {
        StubCtx ctx = new StubCtx();
        LlmModelCommands.handle("fetchModels", null, "req-42", args("{}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals("req-42", res.get("requestId").getAsString());
        assertEquals("fetchModels", res.get("action").getAsString());
        assertFalse("error".equals(res.get("type").getAsString()),
                "the generic error frame must never answer a list verb");
    }

    // ── Endpoint validation on the models path (before any network call) ──

    @Test
    void fetchModelsWithoutAnEndpointIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        LlmModelCommands.handle("fetchModels", null, "m2", args("{}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals(LlmModelCommands.MODELS_ERROR_FRAME, res.get("type").getAsString());
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertEquals(0, LlmModelCommands.inFlight());
    }

    @Test
    void fetchModelsToAHostOffTheAllowlistIsRejectedTypedBeforeAnyCall() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        LlmModelCommands.handle("fetchModels", null, "m3",
                args("{\"apiEndpoint\":\"https://api.example.com/v1/chat/completions\"}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals(LlmModelCommands.MODELS_ERROR_FRAME, res.get("type").getAsString());
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertTrue(res.get("message").getAsString().contains("api.example.com"),
                res.get("message").getAsString());
        assertFalse(res.get("message").getAsString().contains("allowedModelHosts"),
                "the operator flag name must not leak into the player-facing frame");
        assertEquals(0, LlmModelCommands.inFlight());
    }

    @Test
    void fetchModelsToACloudMetadataHostIsRejected() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        LlmModelCommands.handle("fetchModels", null, "m4",
                args("{\"apiEndpoint\":\"http://169.254.169.254/latest/meta-data\"}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertTrue(res.get("message").getAsString().contains("metadata"));
    }

    @Test
    void fetchModelsWithANonHttpSchemeIsRejected() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        LlmModelCommands.handle("fetchModels", null, "m5",
                args("{\"apiEndpoint\":\"ftp://localhost/x\"}"), ctx);
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastFrame(ctx).get("errorCode").getAsString());
    }

    // ── Background path: an allowed endpoint that refuses answers a typed error, never throws ──

    @Test
    void fetchModelsOnAnAllowedEndpointThatRefusesAnswersTypedInTheBackground() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        // port 1 on loopback is in the allowlist and refuses: the fetch fails, typed
        LlmModelCommands.handle("fetchModels", null, "m6",
                args("{\"apiEndpoint\":\"http://127.0.0.1:1/v1/chat/completions\"}"), ctx);
        JsonObject res = awaitFrame(ctx, LlmModelCommands.MODELS_ERROR_FRAME);
        assertEquals(ProxyProtocol.ERR_FAILED, res.get("errorCode").getAsString());
        assertNull(res.get("data"));
    }

    // ── Personalities happy path (pure registry read, no network) ──

    @Test
    void fetchPersonalitiesOnAnLlmServerAnswersTheRegistry() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        LlmModelCommands.handle("fetchPersonalities", null, "p2", args("{}"), ctx);
        JsonObject res = lastFrame(ctx);
        assertEquals("result", res.get("type").getAsString());
        assertTrue(res.get("ok").getAsBoolean());
        JsonObject data = res.getAsJsonObject("data");
        assertTrue(data.getAsJsonArray("personalities").size() > 0);
        List<String> names = new ArrayList<>();
        data.getAsJsonArray("personalities").forEach(e -> names.add(e.getAsString()));
        assertTrue(names.contains("alex"), names.toString());
        assertTrue(names.contains("blake"), names.toString());
    }

    // ── Parse of a stubbed /v1/models body (the OpenAI shape) ──

    @Test
    void parseIdListReadsTheOpenAiDataIdShape() {
        String body = "{\"object\":\"list\",\"data\":[{\"id\":\"gpt-5\",\"object\":\"model\"},"
                + "{\"id\":\"llama3\"},{\"noId\":true}]}";
        assertEquals(Arrays.asList("gpt-5", "llama3"),
                LlmModelCommands.parseIdList(body, "data", "id"));
    }

    @Test
    void parseIdListReadsTheOllamaModelsNameShape() {
        String body = "{\"models\":[{\"name\":\"deepseek-v4.1:cloud\"},{\"name\":\"glm-5.3\"}]}";
        assertEquals(Arrays.asList("deepseek-v4.1:cloud", "glm-5.3"),
                LlmModelCommands.parseIdList(body, "models", "name"));
    }

    @Test
    void parseIdListOnAnUnexpectedShapeIsEmptyNotAnError() {
        assertEquals(0, LlmModelCommands.parseIdList("{\"data\":{}}", "data", "id").size());
        assertEquals(0, LlmModelCommands.parseIdList("{}", "data", "id").size());
        assertEquals(0, LlmModelCommands.parseIdList("[1,2,3]", "data", "id").size());
    }

    @Test
    void parseIdListOnMalformedJsonIsATypedFailureInput() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                () -> LlmModelCommands.parseIdList("<html>not json</html>", "data", "id"));
    }

    // ── Base URL derivation and the Ollama probe ──

    @Test
    void baseUrlOfStripsTheChatCompletionsTail() {
        assertEquals("http://localhost:11434",
                LlmModelCommands.baseUrlOf("http://localhost:11434/v1/chat/completions"));
        assertEquals("https://api.openai.com",
                LlmModelCommands.baseUrlOf("https://api.openai.com/v1/chat/completions"));
        assertEquals("http://localhost:11434", LlmModelCommands.baseUrlOf("http://localhost:11434/v1"));
        assertEquals("http://localhost:11434", LlmModelCommands.baseUrlOf("http://localhost:11434/"));
        assertEquals("http://localhost:11434", LlmModelCommands.baseUrlOf("http://localhost:11434"));
    }

    @Test
    void looksLikeOllamaDetectsTheLocalProvider() {
        assertTrue(LlmModelCommands.looksLikeOllama("http://localhost:11434/v1/chat/completions"));
        assertTrue(LlmModelCommands.looksLikeOllama("https://ollama.com/v1/chat/completions"));
        assertFalse(LlmModelCommands.looksLikeOllama("https://api.openai.com/v1/chat/completions"));
        assertFalse(LlmModelCommands.looksLikeOllama(null));
    }

    // ── Shared endpoint policy: llmConfigs and the list verb agree ──

    @Test
    void theListVerbReusesTheLlmConfigsEndpointPolicy() {
        java.util.Set<String> allowed = new java.util.HashSet<>(Arrays.asList("localhost", "127.0.0.1", "::1"));
        assertEquals("http://127.0.0.1:11434/v1/chat/completions",
                LlmConfigs.validateModelEndpoint("http://127.0.0.1:11434/v1/chat/completions", allowed));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.validateModelEndpoint("https://api.example.com/v1/chat/completions", allowed));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.validateModelEndpoint("ftp://localhost/x", allowed));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.validateModelEndpoint("http://169.254.169.254/x", allowed));
    }

    @Test
    void typedErrorJsonCarriesTheFrameNameTheReasonAndNeverTheGenericType() {
        JsonObject o = JsonParser.parseString(ProxyProtocol.typedErrorJson(
                LlmModelCommands.MODELS_ERROR_FRAME, "fetchModels", "9",
                ProxyProtocol.ERR_INVALID_ARGUMENT, "nope")).getAsJsonObject();
        assertEquals("models_error", o.get("type").getAsString());
        assertEquals("9", o.get("requestId").getAsString());
        assertEquals("fetchModels", o.get("action").getAsString());
        assertFalse(o.get("ok").getAsBoolean());
        assertEquals("INVALID_ARGUMENT", o.get("errorCode").getAsString());
        assertEquals("nope", o.get("message").getAsString());
    }
}
