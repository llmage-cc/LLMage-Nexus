package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.game.match.MatchOptions;
import mage.players.LLMPlayerConfig;
import mage.players.PlayerType;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The llmConfigs seam: parsing (alignment to COMPUTER_LLM seats, field mapping, validations)
 * and its wiring through createTable / createTournamentTable.
 */
class LlmConfigsTest {

    private static final Set<String> LOCAL_ONLY = new HashSet<>(Arrays.asList("localhost", "127.0.0.1", "::1"));

    private static JsonObject args(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private static List<PlayerType> seats(PlayerType... types) {
        return new ArrayList<>(Arrays.asList(types));
    }

    // ── Alignment ──

    @Test
    void oneEntryPerLlmSeatInSeatOrder() {
        JsonObject a = args("{\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\",\"COMPUTER_MAD\",\"COMPUTER_LLM\"],"
                + "\"llmConfigs\":[{\"model\":\"m1\"},{\"model\":\"m2\"}]}");
        List<LLMPlayerConfig> out = LlmConfigs.parse(a, seats(PlayerType.HUMAN, PlayerType.COMPUTER_LLM,
                PlayerType.COMPUTER_MAD, PlayerType.COMPUTER_LLM), LOCAL_ONLY);
        assertEquals(2, out.size());
        assertEquals("m1", out.get(0).getModel());
        assertEquals("m2", out.get(1).getModel());
    }

    @Test
    void nullEntryMeansServerDefaultsForThatSeat() {
        JsonObject a = args("{\"llmConfigs\":[null]}");
        List<LLMPlayerConfig> out = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY);
        assertEquals(1, out.size());
        assertNull(out.get(0));
    }

    @Test
    void absentEntriesPadWithNulls() {
        JsonObject a = args("{\"llmConfigs\":[{\"model\":\"m1\"}]}");
        List<LLMPlayerConfig> out = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM, PlayerType.COMPUTER_LLM), LOCAL_ONLY);
        assertEquals(2, out.size());
        assertEquals("m1", out.get(0).getModel());
        assertNull(out.get(1));
    }

    @Test
    void noLlmSeatMeansEmptyListEvenWithConfigs() {
        JsonObject a = args("{\"llmConfigs\":[{\"model\":\"m1\"}]}");
        List<LLMPlayerConfig> out = LlmConfigs.parse(a, seats(PlayerType.HUMAN, PlayerType.COMPUTER_MAD), LOCAL_ONLY);
        assertTrue(out.isEmpty());
    }

    @Test
    void nonObjectEntryIsRejected() {
        JsonObject a = args("{\"llmConfigs\":[42]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("llmConfigs[0]"), ex.getMessage());
    }

    // ── Field mapping ──

    @Test
    void mapsTheWireFieldsIntoLlmPlayerConfig() {
        JsonObject a = args("{\"llmConfigs\":[{"
                + "\"model\":\"deepseek-v4\",\"apiEndpoint\":\"http://localhost:11434/v1/chat/completions\","
                + "\"apiKey\":\"secret\",\"reasoningEffort\":\"high\","
                + "\"reasoningEffortLevels\":[\"high\",\"medium\"],"
                + "\"thinkingEnabled\":true,\"temperatureEnabled\":true,\"temperature\":0.7,"
                + "\"maxTokens\":4096,\"timeoutSeconds\":120,\"streamingEnabled\":false,"
                + "\"verboseLogging\":true,\"deckAssessmentEnabled\":false,\"concedeEnabled\":true,"
                + "\"askReason\":true,\"transcriptDir\":\"/tmp/t\",\"personalityEnabled\":true,"
                + "\"personalityName\":\"Jace\",\"botName\":\"Bot1\","
                + "\"conversationMaxExchanges\":10,\"conversationMaxHistoryChars\":5000,"
                + "\"conversationThinkCharsPerMsg\":900,\"summarizeTriggerChars\":12000,"
                + "\"summarizeContextRatio\":0.6,\"modelContextWindow\":131072,"
                + "\"summarizeTargetChars\":3000,\"summarizeTargetRatio\":0.2,"
                + "\"summarizeKeepExchanges\":4}]}");
        List<LLMPlayerConfig> out = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY);
        LLMPlayerConfig c = out.get(0);
        assertEquals("deepseek-v4", c.getModel());
        assertEquals("http://localhost:11434/v1/chat/completions", c.getApiEndpoint());
        assertEquals("secret", c.getApiKey());
        assertEquals("high", c.getReasoningEffort());
        assertEquals(Arrays.asList("high", "medium"), c.getReasoningEffortLevels());
        assertEquals(Boolean.TRUE, c.isThinkingEnabled());
        assertEquals(Boolean.TRUE, c.getTemperatureEnabled());
        assertEquals(0.7, c.getTemperature(), 1e-9);
        assertEquals(Integer.valueOf(4096), c.getMaxTokens());
        assertEquals(Integer.valueOf(120), c.getTimeoutSeconds());
        assertEquals(Boolean.FALSE, c.isStreamingEnabled());
        assertEquals(Boolean.TRUE, c.isVerboseLogging());
        assertEquals(Boolean.FALSE, c.isDeckAssessmentEnabled());
        assertEquals(Boolean.TRUE, c.isConcedeEnabled());
        assertEquals(Boolean.TRUE, c.isAskReason());
        assertEquals("/tmp/t", c.getTranscriptDir());
        assertEquals(Boolean.TRUE, c.isPersonalityEnabled());
        assertEquals("Jace", c.getPersonalityName());
        assertEquals("Bot1", c.getBotName());
        assertEquals(Integer.valueOf(10), c.getConversationMaxExchanges());
        assertEquals(Integer.valueOf(5000), c.getConversationMaxHistoryChars());
        assertEquals(Integer.valueOf(900), c.getConversationThinkCharsPerMsg());
        assertEquals(Integer.valueOf(12000), c.getSummarizeTriggerChars());
        assertEquals(0.6, c.getSummarizeContextRatio(), 1e-9);
        assertEquals(Integer.valueOf(131072), c.getModelContextWindow());
        assertEquals(Integer.valueOf(3000), c.getSummarizeTargetChars());
        assertEquals(0.2, c.getSummarizeTargetRatio(), 1e-9);
        assertEquals(Integer.valueOf(4), c.getSummarizeKeepExchanges());
    }

    @Test
    void emptyStringsAndNullsLeaveServerDefaults() {
        JsonObject a = args("{\"llmConfigs\":[{\"model\":\"\",\"apiEndpoint\":null,\"apiKey\":\"\","
                + "\"reasoningEffort\":\"default\",\"modelContextWindow\":0,\"temperature\":null}]}");
        LLMPlayerConfig c = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY).get(0);
        assertNull(c.getModel());
        assertNull(c.getApiEndpoint());
        assertNull(c.getApiKey());
        assertNull(c.getReasoningEffort(), "\"default\" is the dialog sentinel, not an override");
        assertNull(c.getModelContextWindow(), "0 means auto-detect: not an override");
        assertNull(c.getTemperature());
    }

    @Test
    void wrongFieldTypesAreRejectedLoudly() {
        JsonObject a = args("{\"llmConfigs\":[{\"maxTokens\":\"many\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("maxTokens"), ex.getMessage());
    }

    // ── Endpoint validation ──

    @Test
    void endpointOffTheAllowlistIsRejected() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"https://api.example.com/v1/chat/completions\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("allowlist"), ex.getMessage());
        assertTrue(ex.getMessage().contains("api.example.com"), ex.getMessage());
    }

    @Test
    void endpointOnTheAllowlistPasses() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"http://127.0.0.1:11434/v1/chat/completions\"}]}");
        LLMPlayerConfig c = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY).get(0);
        assertEquals("http://127.0.0.1:11434/v1/chat/completions", c.getApiEndpoint());
    }

    @Test
    void ipv6LoopbackEndpointMatchesTheBareFormEntry() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"http://[::1]:11434/v1/chat/completions\"}]}");
        LLMPlayerConfig c = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY).get(0);
        assertEquals("http://[::1]:11434/v1/chat/completions", c.getApiEndpoint());
    }

    @Test
    void nonHttpSchemesAreRejected() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"ftp://localhost/x\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("http/https"), ex.getMessage());
    }

    @Test
    void cloudMetadataHostsAreBlocked() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"http://169.254.169.254/latest\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("metadata"), ex.getMessage());
    }

    // ── Client-key bridge ──

    @Test
    void apiKeyAndUseClientKeyTogetherAreRejected() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiKey\":\"k\",\"useClientKey\":true,\"clientKeyTag\":\"t\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("useClientKey"), ex.getMessage());
    }

    @Test
    void useClientKeyWithoutTagIsRejected() {
        JsonObject a = args("{\"llmConfigs\":[{\"useClientKey\":true}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY));
        assertTrue(ex.getMessage().contains("clientKeyTag"), ex.getMessage());
    }

    @Test
    void useClientKeyWithTagIsKeptAndKeyStaysNull() {
        JsonObject a = args("{\"llmConfigs\":[{\"useClientKey\":true,\"clientKeyTag\":\"seat-3\"}]}");
        LLMPlayerConfig c = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY).get(0);
        assertEquals(Boolean.TRUE, c.getUseClientKey());
        assertEquals("seat-3", c.getClientKeyTag());
        assertNull(c.getApiKey());
    }

    // ── Wiring through the command handlers ──

    static final class StubSession extends SessionImpl {
        MatchOptions created;
        mage.game.tournament.TournamentOptions createdTournament;

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
        public mage.view.TableView createTable(UUID roomId, MatchOptions options) {
            created = options;
            return null; // no TableView data: ok=false via sendFailure is fine for this seam
        }

        @Override
        public mage.view.TableView createTournamentTable(UUID roomId, mage.game.tournament.TournamentOptions options) {
            createdTournament = options;
            return null;
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
            return ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1",
                    java.util.Arrays.asList("HUMAN", "COMPUTER_LLM"));
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

    private static JsonObject lastResult(StubCtx ctx) {
        assertFalse(ctx.gateway.sent.isEmpty());
        return JsonParser.parseString(ctx.gateway.sent.get(ctx.gateway.sent.size() - 1)).getAsJsonObject();
    }

    @Test
    void createTableForwardsParsedConfigsOnMatchOptions() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "c1", args(
                "{\"name\":\"T\",\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"],"
                        + "\"llmConfigs\":[{\"model\":\"m1\",\"apiEndpoint\":\"http://localhost:11434/v1/chat/completions\"}]}"), ctx);
        assertTrue(ctx.session.created != null);
        List<LLMPlayerConfig> wired = ctx.session.created.getLlmPlayerConfigs();
        assertEquals(1, wired.size());
        assertEquals("m1", wired.get(0).getModel());
    }

    @Test
    void createTableWithoutLlmConfigsLeavesTheListEmpty() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "c2", args("{\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"]}"), ctx);
        assertTrue(ctx.session.created.getLlmPlayerConfigs().isEmpty());
    }

    @Test
    void createTableWithBadEndpointAnswersTypedInvalidArgumentBeforeAnyRpc() throws Exception {
        StubCtx ctx = new StubCtx();
        TableCommands.handle("createTable", null, "c3", args(
                "{\"playerTypes\":[\"COMPUTER_LLM\"],\"llmConfigs\":[{\"apiEndpoint\":\"http://evil.example.com/v1\"}]}"), ctx);
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertTrue(res.get("error").getAsString().contains("allowlist"), res.get("error").getAsString());
        assertNull(ctx.session.created, "no server RPC may happen on a rejected config");
    }

    @Test
    void createTournamentTableForwardsParsedConfigsOnTheMatchOptions() throws Exception {
        StubCtx ctx = new StubCtx();
        TournamentCommands.handle("createTournamentTable", null, "c4", args(
                "{\"tournamentType\":\"Elimination\",\"playerTypes\":[\"HUMAN\",\"COMPUTER_LLM\"],"
                        + "\"llmConfigs\":[{\"model\":\"m2\"}]}"), ctx);
        assertTrue(ctx.session.createdTournament != null);
        List<LLMPlayerConfig> wired = ctx.session.createdTournament.getMatchOptions().getLlmPlayerConfigs();
        assertEquals(1, wired.size());
        assertEquals("m2", wired.get(0).getModel());
    }

    @Test
    void createTournamentTableWithBadClientKeyConfigAnswersTypedInvalidArgument() throws Exception {
        StubCtx ctx = new StubCtx();
        TournamentCommands.handle("createTournamentTable", null, "c5", args(
                "{\"playerTypes\":[\"COMPUTER_LLM\"],\"llmConfigs\":[{\"useClientKey\":true}]}"), ctx);
        JsonObject res = lastResult(ctx);
        assertFalse(res.get("ok").getAsBoolean());
        assertEquals(ProxyProtocol.ERR_INVALID_ARGUMENT, res.get("errorCode").getAsString());
        assertNull(ctx.session.createdTournament);
    }

    // ── Config ──

    @Test
    void allowedModelHostsDefaultToLoopbackAndParseFromFlags() {
        Config defaults = Config.parse(new String[0]);
        assertEquals(new HashSet<>(Arrays.asList("localhost", "127.0.0.1", "::1")), defaults.getAllowedModelHosts());
        Config custom = Config.parse(new String[]{"--allowedModelHosts", " api.example.com ,localhost "});
        assertEquals(new HashSet<>(Arrays.asList("api.example.com", "localhost")), custom.getAllowedModelHosts());
        assertTrue(Config.parse(new String[]{"--allowedModelHosts", ""}).getAllowedModelHosts().isEmpty());
    }

    @Test
    void hostSetMatchingIgnoresCase() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"http://LOCALHOST:11434/v1\"}]}");
        LLMPlayerConfig c = LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), LOCAL_ONLY).get(0);
        assertEquals("http://LOCALHOST:11434/v1", c.getApiEndpoint());
    }

    @Test
    void emptyAllowlistRejectsEveryEndpoint() {
        JsonObject a = args("{\"llmConfigs\":[{\"apiEndpoint\":\"http://localhost:11434/v1\"}]}");
        assertThrows(IllegalArgumentException.class,
                () -> LlmConfigs.parse(a, seats(PlayerType.COMPUTER_LLM), Collections.emptySet()));
    }
}
