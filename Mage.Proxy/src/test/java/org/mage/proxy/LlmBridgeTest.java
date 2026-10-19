package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.interfaces.LLMPromptPayload;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The client-key prompt bridge proxy side — the typed
 * {@code llm_prompt} frame for the fork-only {@code LLM_PROMPT} callback, and the
 * {@code llm_decision} / {@code llm_error} return verbs behind the cached reflection seam.
 */
class LlmBridgeTest {

    static final UUID GAME = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
    static final UUID SEAT = UUID.fromString("00000000-0000-0000-0000-0000000000bb");
    static final UUID RID = UUID.fromString("00000000-0000-0000-0000-0000000000cc");

    /** {@code SessionImpl} with the fork-only bridge methods observable. */
    static final class StubSession extends SessionImpl {
        LLMPromptPayload.Decision decision;
        LLMPromptPayload.Failure failure;
        boolean decisionResult = true;
        boolean errorResult = true;

        StubSession() {
            super(null);
        }

        @Override
        public boolean llmDecision(LLMPromptPayload.Decision d) {
            decision = d;
            return decisionResult;
        }

        @Override
        public boolean llmError(LLMPromptPayload.Failure f) {
            failure = f;
            return errorResult;
        }
    }

    static final class CapturingGateway extends Gateway {
        final List<String> sent = new ArrayList<>();

        CapturingGateway() {
            super(Config.parse(new String[]{"--wsPort", "0", "--simRoster", "none"}));
        }

        @Override
        public void send(WebSocket conn, String json) {
            sent.add(json);
        }
    }

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
            return ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1",
                    Arrays.asList("HUMAN", "COMPUTER_LLM"));
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

    @AfterEach
    void restoreSeam() {
        LlmDecisionSupport.resetForTest();
    }

    private static JsonObject args(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private static JsonObject lastResult(StubCtx ctx) {
        assertFalse(ctx.gateway.sent.isEmpty());
        return JsonParser.parseString(ctx.gateway.sent.get(ctx.gateway.sent.size() - 1)).getAsJsonObject();
    }

    private static boolean handle(StubCtx ctx, String action, String argsJson) {
        return LlmBridgeCommands.handle(action, null, "r1", args(argsJson), ctx);
    }

    // ── capability gate ──

    @Test
    void bothVerbsAreRejectedTypedWhenTheLlmCapabilityIsMissing() {
        for (String action : new String[]{"llm_decision", "llm_error"}) {
            StubCtx ctx = new StubCtx();
            String body = "llm_decision".equals(action)
                    ? "{\"requestId\":\"" + RID + "\",\"rawResponse\":\"{}\"}"
                    : "{\"requestId\":\"" + RID + "\",\"message\":\"boom\",\"retryable\":true}";
            assertTrue(handle(ctx, action, body));
            JsonObject res = lastResult(ctx);
            assertFalse(res.get("ok").getAsBoolean());
            assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
            assertNull(ctx.session.decision, "no RPC behind the gate");
            assertNull(ctx.session.failure, "no RPC behind the gate");
        }
    }

    @Test
    void bothVerbsAreRejectedTypedWhenTheRunningClassHasNoBridge() {
        LlmDecisionSupport.overrideForTest(null, null, null, null);
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "llm_decision", "{\"requestId\":\"" + RID + "\",\"rawResponse\":\"{}\"}");
        JsonObject res = lastResult(ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("client-key"), res.get("error").getAsString());
        assertNull(ctx.session.decision);
    }

    // ── argument validation ──

    @Test
    void aNonUuidOrMissingRequestIdIsInvalidArgument() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "llm_decision", "{\"rawResponse\":\"{}\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        handle(ctx, "llm_decision", "{\"requestId\":\"nope\",\"rawResponse\":\"{}\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        handle(ctx, "llm_error", "{\"message\":\"x\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.decision);
        assertNull(ctx.session.failure);
    }

    @Test
    void anEmptyRawResponseIsInvalidArgument() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "llm_decision", "{\"requestId\":\"" + RID + "\",\"rawResponse\":\"\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.decision);
    }

    // ── forwarding + seam ──

    @Test
    void aDecisionIsForwardedThroughTheSeamWithItsFields() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "llm_decision",
                "{\"requestId\":\"" + RID + "\",\"rawResponse\":\"{\\\"ok\\\":1}\",\"thinking\":\"hmm\",\"httpStatus\":200}");
        assertTrue(lastResult(ctx).get("ok").getAsBoolean(), ctx.gateway.sent.toString());
        assertNotNull(ctx.session.decision);
        assertEquals(RID, ctx.session.decision.requestId);
        assertEquals("{\"ok\":1}", ctx.session.decision.rawResponse);
        assertEquals("hmm", ctx.session.decision.thinking);
        assertEquals(200, ctx.session.decision.httpStatus);
    }

    @Test
    void aFailedDecisionReturnIsAPlainFailure() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        ctx.session.decisionResult = false;
        handle(ctx, "llm_decision", "{\"requestId\":\"" + RID + "\",\"rawResponse\":\"{}\"}");
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_FAILED, res.get("errorCode").getAsString());
    }

    @Test
    void anErrorIsForwardedThroughTheSeamWithItsFields() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "llm_error",
                "{\"requestId\":\"" + RID + "\",\"message\":\"rate limited\",\"retryable\":true,\"httpStatus\":429}");
        assertTrue(lastResult(ctx).get("ok").getAsBoolean());
        assertNotNull(ctx.session.failure);
        assertEquals(RID, ctx.session.failure.requestId);
        assertEquals("rate limited", ctx.session.failure.message);
        assertTrue(ctx.session.failure.retryable);
        assertEquals(429, ctx.session.failure.httpStatus);
    }

    @Test
    void aFailedErrorReturnIsAPlainFailure() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        ctx.session.errorResult = false;
        handle(ctx, "llm_error", "{\"requestId\":\"" + RID + "\",\"message\":\"boom\",\"retryable\":false}");
        assertEquals(ProxyProtocol.ERR_FAILED, lastResult(ctx).get("errorCode").getAsString());
    }

    @Test
    void unknownActionsAreNotClaimed() {
        StubCtx ctx = new StubCtx();
        assertFalse(LlmBridgeCommands.handle("replaySeek", null, "r1", new JsonObject(), ctx));
    }

    @Test
    void theBridgeVerbsAreQuietInTheActivityLog() {
        assertTrue(Activity.isQuietAction("llm_decision"));
        assertTrue(Activity.isQuietAction("llm_error"));
    }

    // ── typed frame from the callback ──

    @Test
    void aLlmPromptPayloadBecomesATypedFrameWithNoKey() {
        assertTrue(LlmPromptBridge.isLlmPrompt(ClientCallbackMethod.LLM_PROMPT));
        assertFalse(LlmPromptBridge.isLlmPrompt(ClientCallbackMethod.GAME_UPDATE));
        LLMPromptPayload payload = new LLMPromptPayload(RID, SEAT, GAME, "glm-flash-Kestrel",
                "{\"model\":\"m\"}", "https://api.example.com/v1/chat/completions", true, 30, "seat-tag");
        JsonObject frame = JsonParser.parseString(LlmPromptBridge.frame(payload)).getAsJsonObject();
        assertEquals("llm_prompt", frame.get("type").getAsString());
        assertEquals(RID.toString(), frame.get("requestId").getAsString());
        assertEquals(SEAT.toString(), frame.get("seatId").getAsString());
        assertEquals(GAME.toString(), frame.get("gameId").getAsString());
        assertEquals("glm-flash-Kestrel", frame.get("playerName").getAsString());
        assertEquals("{\"model\":\"m\"}", frame.get("requestBody").getAsString());
        assertEquals("https://api.example.com/v1/chat/completions", frame.get("apiEndpoint").getAsString());
        assertTrue(frame.get("stream").getAsBoolean());
        assertEquals(30, frame.get("timeoutSeconds").getAsInt());
        assertEquals("seat-tag", frame.get("clientKeyTag").getAsString());
        assertFalse(frame.has("apiKey"), "the payload carries NO key");
        assertFalse(frame.has("key"));
    }

    @Test
    void aMapPayloadIsAlsoAccepted() {
        java.util.Map<String, Object> map = new java.util.HashMap<>();
        map.put("requestId", RID.toString());
        map.put("seatId", SEAT.toString());
        map.put("gameId", GAME.toString());
        map.put("stream", Boolean.FALSE);
        map.put("timeoutSeconds", 12);
        map.put("clientKeyTag", "tag");
        JsonObject frame = JsonParser.parseString(LlmPromptBridge.frame(map)).getAsJsonObject();
        assertEquals("llm_prompt", frame.get("type").getAsString());
        assertEquals(RID.toString(), frame.get("requestId").getAsString());
        assertFalse(frame.get("stream").getAsBoolean());
        assertEquals(12, frame.get("timeoutSeconds").getAsInt());
    }

    @Test
    void aNonBridgePayloadIsSkipped() {
        assertNull(LlmPromptBridge.frame(new Object()));
        assertNull(LlmPromptBridge.frame(null));
    }

    // ── end-to-end: a real callback goes out as a typed frame, never an event ──

    static final class RecordingGateway extends Gateway {
        final List<JsonObject> frames = new ArrayList<>();

        RecordingGateway() {
            super(Config.parse(new String[]{"--wsPort", "0", "--simRoster", "none"}));
        }

        @Override
        public synchronized void send(WebSocket conn, String json) {
            frames.add(JsonParser.parseString(json).getAsJsonObject());
        }
    }

    private static WebSocket conn() {
        return (WebSocket) Proxy.newProxyInstance(WebSocket.class.getClassLoader(), new Class<?>[]{WebSocket.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("equals")) {
                        return proxy == args[0];
                    }
                    if (method.getName().equals("hashCode")) {
                        return System.identityHashCode(proxy);
                    }
                    return method.getReturnType() == boolean.class ? Boolean.TRUE : null;
                });
    }

    @Test
    void aRealLlmPromptCallbackBroadcastsTheTypedFrameNotAnEvent() throws Exception {
        RecordingGateway gateway = new RecordingGateway();
        ProxyClient client = new ProxyClient(gateway.getConfig(), gateway);
        try {
            WebSocket conn = conn();
            client.attach(conn, "1", null, -1);
            LLMPromptPayload payload = new LLMPromptPayload(RID, SEAT, GAME, "P",
                    "{\"model\":\"m\"}", "https://api.example.com/v1", false, 9, "tag");
            ClientCallback cb = new ClientCallback(ClientCallbackMethod.LLM_PROMPT, GAME, payload);
            cb.setMessageId(1);
            client.onCallback(cb);

            long deadline = System.currentTimeMillis() + 5000;
            JsonObject frame = null;
            while (System.currentTimeMillis() < deadline) {
                synchronized (gateway) {
                    frame = gateway.frames.stream()
                            .filter(f -> "llm_prompt".equals(f.get("type").getAsString()))
                            .findFirst().orElse(null);
                }
                if (frame != null) {
                    break;
                }
                Thread.sleep(10);
            }
            assertNotNull(frame, "the typed llm_prompt frame must be broadcast");
            assertEquals("tag", frame.get("clientKeyTag").getAsString());
            synchronized (gateway) {
                boolean anyLlmEvent = gateway.frames.stream().anyMatch(f ->
                        "event".equals(f.get("type").getAsString())
                                && f.has("method")
                                && "LLM_PROMPT".equals(f.get("method").getAsString()));
                assertFalse(anyLlmEvent, "never the generic event envelope for LLM_PROMPT");
            }
        } finally {
            client.shutdown();
        }
    }
}
