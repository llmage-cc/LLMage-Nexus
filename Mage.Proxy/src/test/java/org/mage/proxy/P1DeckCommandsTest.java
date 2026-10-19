package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code getP1Decks}: typed {@code CAPABILITY_UNAVAILABLE} when the server
 * reports no {@code p1} capability AND when the fork-only {@code P1DeckPool} is absent; the payload
 * {@code {decks:[{name,deck}],default}} when both are present.
 */
class P1DeckCommandsTest {

    static final class StubCtx implements CommandContext {

        @Override
        public boolean simEnabled() {
            return true;
        }
        final SessionImpl session = new SessionImpl(null);
        final CapturingGateway gateway = new CapturingGateway();
        private ServerCapabilities caps = ServerCapabilities.none();

        void setCaps(ServerCapabilities caps) {
            this.caps = caps;
        }

        static ServerCapabilities p1Server() {
            return ServerCapabilities.forTest(false, true, false, false, "1.4.62-V1",
                    Arrays.asList("HUMAN", "COMPUTER_P1"));
        }

        static ServerCapabilities llmOnlyServer() {
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
            gateway.send(conn, ProxyProtocol.resultJson(action, requestId, false, ProxyProtocol.ERR_FAILED, null));
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

    @AfterEach
    void restoreSeam() {
        // the seam caches statically; a test that faked its absence must not leak into the next
        P1DeckSupport.resetForTest();
    }

    private static JsonObject last(StubCtx ctx) {
        assertFalse(ctx.gateway.sent.isEmpty());
        return JsonParser.parseString(ctx.gateway.sent.get(ctx.gateway.sent.size() - 1)).getAsJsonObject();
    }

    private static boolean handle(StubCtx ctx) {
        return P1DeckCommands.handle("getP1Decks", null, "r1", new JsonObject(), ctx);
    }

    // ── gate ──

    @Test
    void theVerbIsRejectedTypedWhenTheServerHasNoP1Capability() {
        StubCtx ctx = new StubCtx(); // none(): p1 false
        assertTrue(handle(ctx));
        JsonObject res = last(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("P1"), res.get("error").getAsString());
    }

    @Test
    void anLlmOnlyServerStillCannotServeTheP1Decks() {
        // p1 is independent of llm (a server can run LLM seats but not COMPUTER_P1)
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmOnlyServer());
        handle(ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, last(ctx).get("errorCode").getAsString());
    }

    @Test
    void aNonP1VerbIsNotClaimed() {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.p1Server());
        assertFalse(P1DeckCommands.handle("getTables", null, "r1", new JsonObject(), ctx));
    }

    // ── reflection seam ──

    @Test
    void theRunningClassCarriesTheForkOnlyPool() {
        // the 1.4.62 artifacts this proxy is built against carry mage.cards.decks.P1DeckPool
        P1DeckSupport.resetForTest();
        assertTrue(P1DeckSupport.available(), "the 1.4.62 artifacts carry P1DeckPool");
    }

    @Test
    void anAbsentPoolAnswersTheTypedCapabilityError() {
        // fork-only P1DeckPool absent (stock build): the verb degrades, never a raw NoSuchMethodError
        P1DeckSupport.overrideForTest(null, null, null, null);
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.p1Server());
        handle(ctx);
        JsonObject res = last(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
    }

    // ── payload ──

    @Test
    void thePayloadCarriesTheFiftyFiveTrainingDecksAndTheDefault() {
        P1DeckSupport.resetForTest();
        assertEquals(55, P1DeckSupport.names().size(),
                "the pool ships the 55 Standard training decks");

        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.p1Server());
        assertTrue(handle(ctx));
        JsonObject res = last(ctx);
        assertTrue(res.get("ok").getAsBoolean(), res.toString());
        assertEquals("getP1Decks", res.get("action").getAsString());
        assertEquals("r1", res.get("requestId").getAsString());

        JsonObject data = res.getAsJsonObject("data");
        JsonArray decks = data.getAsJsonArray("decks");
        assertEquals(55, decks.size());
        for (com.google.gson.JsonElement e : decks) {
            JsonObject row = e.getAsJsonObject();
            assertTrue(row.has("name") && !row.get("name").getAsString().isEmpty());
            assertTrue(row.has("deck"), "every deck row carries its deck text");
        }
        assertTrue(data.has("default") && !data.get("default").getAsString().isEmpty(),
                "the deterministic default deck name is present");
    }

    @Test
    void theDefaultNameMatchesThePoolsOwnDefault() {
        P1DeckSupport.resetForTest();
        String def = P1DeckSupport.defaultDeckName();
        assertNotNull(def);
        assertTrue(P1DeckSupport.names().contains(def),
                "the default must be one of the 55 training decks");
    }

    @Test
    void theVerbIsNotInTheQuietSet() {
        // a once-per-form-open read stays on the ordinary logged activity path
        assertFalse(Activity.isQuietAction("getP1Decks"));
    }
}
