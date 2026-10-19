package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.constants.PlayerAction;
import mage.interfaces.callback.ClientCallbackMethod;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Replay support (P1): the {@code replaySeek} verb behind the reflection seam + capability gate +
 * local range check, the player-action gate while a replay is loaded, the live-game guard on
 * {@code replayGame}, and the activity/requiresGameId bookkeeping.
 */
class ReplayProxyTest {

    static final UUID GAME = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
    static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-0000000000bb");

    /** {@code SessionImpl} with the six replay verbs observable and controllable. */
    static final class StubSession extends SessionImpl {
        UUID replayedGame;
        boolean replayGameResult = true;
        boolean seekCalled;
        UUID seekGame;
        int seekIndex = -99;
        boolean seekResult = true;
        boolean playerActionCalled;
        boolean playerBooleanCalled;

        StubSession() {
            super(null);
        }

        @Override
        public boolean replayGame(UUID gameId) {
            replayedGame = gameId;
            return replayGameResult;
        }

        @Override
        public boolean startReplay(UUID gameId) {
            replayedGame = gameId;
            return true;
        }

        @Override
        public boolean stopReplay(UUID gameId) {
            return true;
        }

        @Override
        public boolean seekTo(UUID gameId, int stateIndex) {
            seekCalled = true;
            seekGame = gameId;
            seekIndex = stateIndex;
            return seekResult;
        }

        @Override
        public boolean sendPlayerAction(PlayerAction action, UUID gameId, Object data) {
            playerActionCalled = true;
            return true;
        }

        @Override
        public boolean sendPlayerBoolean(UUID gameId, boolean value) {
            playerBooleanCalled = true;
            return true;
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

    /**
     * Faithful stateful context: mirrors how {@link ProxyClient} answers replayActive /
     * replayStateCount, so the wiring under test is the same shape as production.
     */
    static final class StubCtx implements CommandContext {

        @Override
        public boolean simEnabled() {
            return true;
        }
        final StubSession session = new StubSession();
        final CapturingGateway gateway = new CapturingGateway();
        final ReplayTracker tracker = new ReplayTracker();
        private ServerCapabilities caps = ServerCapabilities.none();
        boolean liveGame;

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
            return tracker.isActive();
        }

        @Override
        public int replayStateCount() {
            return tracker.stateCount();
        }

        @Override
        public boolean liveGameActive() {
            return liveGame;
        }

        @Override
        public void markReplayActive(UUID gameId) {
            tracker.loaded(gameId);
        }

        @Override
        public void clearReplay() {
            tracker.clear();
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

    @AfterEach
    void restoreSeam() {
        // the seam caches statically; a test that faked its absence must not leak into the next
        ReplaySeekSupport.resetForTest();
    }

    private static JsonObject args(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private static JsonObject lastResult(StubCtx ctx) {
        assertFalse(ctx.gateway.sent.isEmpty());
        return JsonParser.parseString(ctx.gateway.sent.get(ctx.gateway.sent.size() - 1)).getAsJsonObject();
    }

    private static boolean handle(StubCtx ctx, String action, String argsJson) throws Exception {
        return GameCommands.handle(action, null, "r1", args(argsJson), ctx);
    }

    // ── replaySeek: capability gate ──

    @Test
    void replaySeekIsRejectedTypedWhenTheScrubberCapabilityIsMissing() throws Exception {
        StubCtx ctx = new StubCtx();
        assertTrue(handle(ctx, "replaySeek",
                "{\"gameId\":\"" + GAME + "\",\"stateIndex\":0}"));
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("scrubber"), res.get("error").getAsString());
        assertFalse(ctx.session.seekCalled, "no server RPC may happen behind the gate");
    }

    @Test
    void replaySeekIsRejectedTypedWhenTheRunningClassHasNoSeek() throws Exception {
        ReplaySeekSupport.overrideForTest(null);
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":0}");
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, lastResult(ctx).get("errorCode").getAsString());
        assertFalse(ctx.session.seekCalled);
    }

    // ── replaySeek: local range check ──

    @Test
    void replaySeekRejectsAnOutOfRangeIndexLocally() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        ctx.tracker.frame(GAME, 5);
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":5}");
        JsonObject res = lastResult(ctx);
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("0..4"), res.get("error").getAsString());
        assertFalse(ctx.session.seekCalled, "an out-of-range seek must never reach the server");
    }

    @Test
    void replaySeekRejectsNegativeAndMissingStateIndex() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":-1}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":\"x\"}");
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, lastResult(ctx).get("errorCode").getAsString());
        assertFalse(ctx.session.seekCalled);
    }

    // ── replaySeek: reflection seam ──

    @Test
    void replaySeekResolvesTheSeamWhenPresentAndForwardsTheIndex() throws Exception {
        assertTrue(ReplaySeekSupport.available(), "the 1.4.62 SessionImpl carries seekTo");
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        ctx.tracker.frame(GAME, 5);
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":3}");
        JsonObject res = lastResult(ctx);
        assertTrue(res.get("ok").getAsBoolean(), res.toString());
        assertTrue(ctx.session.seekCalled);
        assertEquals(GAME, ctx.session.seekGame);
        assertEquals(3, ctx.session.seekIndex);
    }

    @Test
    void replaySeekForwardsWhenTheTrackLengthIsStillUnknown() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        // no frame forwarded yet: the range cannot be checked, so accept the server semantics
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":999}");
        assertTrue(lastResult(ctx).get("ok").getAsBoolean());
        assertTrue(ctx.session.seekCalled);
        assertEquals(999, ctx.session.seekIndex);
    }

    @Test
    void replaySeekReportsAFailedSeekAsPlainFailure() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        ctx.session.seekResult = false;
        handle(ctx, "replaySeek", "{\"gameId\":\"" + GAME + "\",\"stateIndex\":0}");
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_FAILED, res.get("errorCode").getAsString());
    }

    // ── player-action gate while a replay is loaded ──

    @Test
    void playerActionsAreRefusedWhileAReplayIsLoaded() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.markReplayActive(GAME);
        handle(ctx, "sendPlayerAction",
                "{\"gameId\":\"" + GAME + "\",\"action\":\"PASS_PRIORITY\",\"data\":null}");
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertFalse(ctx.session.playerActionCalled, "the gate must run before any server RPC");

        handle(ctx, "sendPlayerBoolean", "{\"gameId\":\"" + GAME + "\",\"value\":false}");
        assertFalse(ctx.session.playerBooleanCalled);
    }

    @Test
    void playerActionsPassOnceTheReplayIsCleared() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.markReplayActive(GAME);
        ctx.clearReplay();
        handle(ctx, "sendPlayerBoolean", "{\"gameId\":\"" + GAME + "\",\"value\":false}");
        assertTrue(ctx.session.playerBooleanCalled);
        assertTrue(lastResult(ctx).get("ok").getAsBoolean());
    }

    @Test
    void theGateIsLiftedOnANonBoundaryReplayDoneAndKeptOnABoundary() {
        ReplayTracker tracker = new ReplayTracker();
        tracker.loaded(GAME);
        tracker.frame(GAME, 10);
        tracker.done(true);
        assertTrue(tracker.isActive(), "a boundary keeps the replay session alive");
        assertEquals(10, tracker.stateCount());
        tracker.done(false);
        assertFalse(tracker.isActive());
        assertEquals(-1, tracker.stateCount());
        assertNull(tracker.gameId());
    }

    // ── replayGame: live-game guard + gate bookkeeping ──

    @Test
    void replayGameRefusesWhileALiveGameIsActive() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.liveGame = true;
        handle(ctx, "replayGame", "{\"gameId\":\"" + GAME + "\"}");
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_FAILED, res.get("errorCode").getAsString());
        assertNull(ctx.session.replayedGame, "no replay may be loaded over a live game");
    }

    @Test
    void replayGameMarksTheGateActiveAndStopReplayClearsIt() throws Exception {
        StubCtx ctx = new StubCtx();
        handle(ctx, "replayGame", "{\"gameId\":\"" + GAME + "\"}");
        assertEquals(GAME, ctx.session.replayedGame);
        assertTrue(ctx.replayActive(), "loading a replay opens the player-action gate");

        handle(ctx, "stopReplay", "{\"gameId\":\"" + GAME + "\"}");
        assertFalse(ctx.replayActive(), "stopping the replay closes the gate");
    }

    // ── bookkeeping: requiresGameId + Activity.QUIET ──

    @Test
    void theReplayVerbsCarryAGameId() {
        assertTrue(ProxyClient.requiresGameId("replayGame"));
        assertTrue(ProxyClient.requiresGameId("startReplay"));
        assertTrue(ProxyClient.requiresGameId("stopReplay"));
        assertTrue(ProxyClient.requiresGameId("replayNext"));
        assertTrue(ProxyClient.requiresGameId("replayPrevious"));
        assertTrue(ProxyClient.requiresGameId("replaySkipForward"));
        assertTrue(ProxyClient.requiresGameId("replaySeek"));
    }

    @Test
    void theReplayVerbsAreQuietInTheActivityLog() {
        assertTrue(Activity.isQuietAction("replayGame"));
        assertTrue(Activity.isQuietAction("startReplay"));
        assertTrue(Activity.isQuietAction("stopReplay"));
        assertTrue(Activity.isQuietAction("replaySkipForward"));
        assertTrue(Activity.isQuietAction("replaySeek"));
        assertFalse(Activity.isQuietAction("createTable"), "lifecycle actions still log");
    }

    // ── the reflective replayStateCount reader ──

    static final class ReplayViewStub {
        public int getReplayStateCount() {
            return 7;
        }
    }

    @Test
    void replayStateCountIsReadReflectivelyAndDegradesToUnknown() {
        assertEquals(7, CallbackEvents.replayStateCount(new ReplayViewStub()));
        assertEquals(-1, CallbackEvents.replayStateCount(new Object()), "a stock payload has no such getter");
        assertEquals(-1, CallbackEvents.replayStateCount(null));
    }

    @Test
    void theFourReplayCallbacksAreRecognised() {
        assertTrue(CallbackEvents.isReplayEvent(ClientCallbackMethod.REPLAY_GAME));
        assertTrue(CallbackEvents.isReplayEvent(ClientCallbackMethod.REPLAY_INIT));
        assertTrue(CallbackEvents.isReplayEvent(ClientCallbackMethod.REPLAY_UPDATE));
        assertTrue(CallbackEvents.isReplayEvent(ClientCallbackMethod.REPLAY_DONE));
        assertFalse(CallbackEvents.isReplayEvent(ClientCallbackMethod.GAME_UPDATE));
    }
}
