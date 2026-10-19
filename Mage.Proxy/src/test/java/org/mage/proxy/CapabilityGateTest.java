package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.players.PlayerType;
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
 * LLM-carrying requests (llmConfigs, COMPUTER_LLM seats) against a server that reported no
 * llm capability are rejected with typed {@code CAPABILITY_UNAVAILABLE} before any server RPC.
 */
class CapabilityGateTest {

    static final class StubSession extends SessionImpl {
        Object created;
        Object joined;

        StubSession() {
            super(null);
        }

        @Override
        public UUID getMainRoomId() {
            return UUID.fromString("00000000-0000-0000-0000-000000000001");
        }

        @Override
        public String getUserName() {
            return "tester";
        }

        @Override
        public mage.view.TableView createTable(UUID roomId, mage.game.match.MatchOptions options) {
            created = options;
            return null;
        }

        @Override
        public mage.view.TableView createTournamentTable(UUID roomId, mage.game.tournament.TournamentOptions options) {
            created = options;
            return null;
        }

        @Override
        public boolean joinTable(UUID roomId, UUID tableId, String name, PlayerType type, int skill,
                                 mage.cards.decks.DeckCardLists deck, String password) {
            joined = type;
            return true;
        }

        @Override
        public boolean joinTournamentTable(UUID roomId, UUID tableId, String name, PlayerType type, int skill,
                                           mage.cards.decks.DeckCardLists deck, String password) {
            joined = type;
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

    private static JsonObject args(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private static JsonObject lastResult(StubCtx ctx) {
        assertFalse(ctx.gateway.sent.isEmpty());
        return JsonParser.parseString(ctx.gateway.sent.get(ctx.gateway.sent.size() - 1)).getAsJsonObject();
    }

    // ── createTable ──

    @Test
    void createTableWithLlmSeatOnAStockServerIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "g1", args(
                "{\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"]}"), ctx);
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("does not support LLM"), res.get("error").getAsString());
        assertNull(ctx.session.created, "no server RPC may happen behind the gate");
    }

    @Test
    void createTableWithLlmConfigsOnAStockServerIsRejectedEvenWithoutTheSeat() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "g2", args(
                "{\"playerTypes\":[\"HUMAN\"],\"llmConfigs\":[{\"model\":\"m\"}]}"), ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.created);
    }

    @Test
    void createTableOfAStockTablePassesOnAStockServer() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "g3", args(
                "{\"playerTypes\":[\"HUMAN\",\"COMPUTER_MAD\"]}"), ctx);
        // the create reached the session (which returned null TableView -> a plain failure)
        assertTrue(ctx.session.created != null, "a stock create must not be blocked by the gate");
        assertEquals(ProxyProtocol.ERR_FAILED, lastResult(ctx).get("errorCode").getAsString());
    }

    @Test
    void createTableWithLlmSeatOnAnLlmServerPasses() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        TableCommands.handle("createTable", null, "g4", args(
                "{\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"],\"llmConfigs\":[{\"model\":\"m\"}]}"), ctx);
        assertTrue(ctx.session.created != null);
        assertTrue(((mage.game.match.MatchOptions) ctx.session.created).getLlmPlayerConfigs().size() == 1);
    }

    // ── createTournamentTable ──

    @Test
    void createTournamentWithLlmSeatOnAStockServerIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        TournamentCommands.handle("createTournamentTable", null, "g5", args(
                "{\"tournamentType\":\"Elimination\",\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"]}"), ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.created);
    }

    // ── joinTable / joinTournamentTable ──

    @Test
    void joiningAsLlmSeatOnAStockServerIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("joinTable", null, "g6", args(
                "{\"playerType\":\"COMPUTER_LLM\"}"), ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.joined, "no server RPC may happen behind the gate");
    }

    @Test
    void joiningAsHumanOnAStockServerPasses() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("joinTable", null, "g7", args(
                "{\"playerType\":\"HUMAN\"}"), ctx);
        assertEquals(PlayerType.HUMAN, ctx.session.joined);
    }

    @Test
    void joiningAsLlmSeatOnAnLlmServerPasses() throws Exception {
        StubCtx ctx = new StubCtx();
        ctx.setCaps(StubCtx.llmServer());
        TableCommands.handle("joinTable", null, "g8", args(
                "{\"playerType\":\"COMPUTER_LLM\"}"), ctx);
        assertEquals(PlayerType.COMPUTER_LLM, ctx.session.joined);
    }

    @Test
    void joiningATournamentAsLlmSeatOnAStockServerIsRejectedTyped() throws Exception {
        StubCtx ctx = new StubCtx();
        TournamentCommands.handle("joinTournamentTable", null, "g9", args(
                "{\"playerType\":\"COMPUTER_LLM\"}"), ctx);
        assertEquals(ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, lastResult(ctx).get("errorCode").getAsString());
        assertNull(ctx.session.joined);
    }

    // ── predicate-level shape ──

    @Test
    void carriesLlmContentSeesConfigsSeatsAndNothingElse() {
        assertFalse(CapabilityGate.carriesLlmContent(args("{}")));
        assertFalse(CapabilityGate.carriesLlmContent(args("{\"playerTypes\":[\"HUMAN\",\"SIM\"]}")));
        assertFalse(CapabilityGate.carriesLlmContent(args("{\"llmConfigs\":[]}")));
        assertFalse(CapabilityGate.carriesLlmContent(args("{\"llmConfigs\":[null]}")),
                "a null-only array carries no config: it is padding, not content");
        assertTrue(CapabilityGate.carriesLlmContent(args("{\"llmConfigs\":[{\"model\":\"m\"}]}")));
        assertTrue(CapabilityGate.carriesLlmContent(args("{\"playerTypes\":[\"COMPUTER_LLM\"]}")));
        assertTrue(CapabilityGate.carriesLlmContent(args("{\"playerTypes\":[\"computer_llm\"]}")));
    }
}
