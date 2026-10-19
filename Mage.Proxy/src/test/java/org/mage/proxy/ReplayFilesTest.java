package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The {@code getReplayFiles} verb. Covers the sorted listing,
 * the non-UUID skip, the missing-directory (not-an-error) answer, the verbatim sidecar {@code
 * meta}, and the loadable-row survival when a sidecar is unreadable/torn — plus the {@code
 * --replayDir} config option and the dispatch wiring.
 */
class ReplayFilesTest {

    static final String A = "00000000-0000-0000-0000-0000000000aa";
    static final String B = "00000000-0000-0000-0000-0000000000bb";

    @TempDir
    Path dir;

    private void game(String id, byte[] body) throws IOException {
        Files.write(dir.resolve(id + ".game"), body);
    }

    // ── listing() ──

    @Test
    void listsUuidGameFilesSortedAscendingWithSizeAndTimestamp() throws IOException {
        game(B, new byte[]{1, 2, 3});
        game(A, new byte[]{1, 2, 3, 4, 5});
        JsonObject listing = ReplayFiles.listing(dir.toString());
        assertTrue(listing.get("exists").getAsBoolean());
        assertEquals(dir.toFile().getAbsolutePath(), listing.get("directory").getAsString());
        assertEquals(java.util.Arrays.asList(A, B), ReplayFiles.gameIds(listing));
        JsonObject first = listing.getAsJsonArray("files").get(0).getAsJsonObject();
        assertEquals(5, first.get("bytes").getAsLong());
        assertTrue(first.get("savedAtMs").getAsLong() > 0);
        assertFalse(first.has("meta"), "no sidecar → no meta key");
    }

    @Test
    void skipsNonUuidGameNamesWithAWarning() throws IOException {
        game(A, new byte[]{1});
        Files.write(dir.resolve("not-a-uuid.game"), new byte[]{9});
        Files.write(dir.resolve("readme.txt"), new byte[]{9});
        JsonObject listing = ReplayFiles.listing(dir.toString());
        assertEquals(java.util.Arrays.asList(A), ReplayFiles.gameIds(listing),
                "a non-UUID *.game name can never be loaded, so it is skipped");
    }

    @Test
    void aMissingDirectoryIsNotAnErrorJustExistsFalse() {
        JsonObject listing = ReplayFiles.listing(dir.resolve("does-not-exist").toString());
        assertFalse(listing.get("exists").getAsBoolean());
        assertEquals(0, listing.getAsJsonArray("files").size());
        assertTrue(listing.get("directory").getAsString().endsWith("does-not-exist"));
    }

    @Test
    void carriesTheSidecarObjectVerbatim() throws IOException {
        game(A, new byte[]{1});
        Files.write(dir.resolve(A + ".json"),
                ("{\"gameId\":\"" + A + "\",\"winner\":\"Alice\",\"turns\":7,\"players\":[]}")
                        .getBytes(StandardCharsets.UTF_8));
        JsonObject row = ReplayFiles.listing(dir.toString()).getAsJsonArray("files").get(0).getAsJsonObject();
        JsonObject meta = row.getAsJsonObject("meta");
        assertEquals("Alice", meta.get("winner").getAsString());
        assertEquals(7, meta.get("turns").getAsInt());
        assertEquals(A, meta.get("gameId").getAsString());
    }

    @Test
    void anUnreadableSidecarKeepsTheLoadableRow() throws IOException {
        game(A, new byte[]{1, 2});
        // torn/corrupt JSON sidecar: the row must survive as a legacy row, meta absent
        Files.write(dir.resolve(A + ".json"), "{not json".getBytes(StandardCharsets.UTF_8));
        JsonObject listing = ReplayFiles.listing(dir.toString());
        assertEquals(java.util.Arrays.asList(A), ReplayFiles.gameIds(listing));
        assertFalse(listing.getAsJsonArray("files").get(0).getAsJsonObject().has("meta"));
    }

    @Test
    void aSidecarThatIsNotAnObjectIsIgnored() throws IOException {
        game(A, new byte[]{1});
        Files.write(dir.resolve(A + ".json"), "[1,2,3]".getBytes(StandardCharsets.UTF_8));
        assertFalse(ReplayFiles.listing(dir.toString()).getAsJsonArray("files").get(0)
                .getAsJsonObject().has("meta"));
    }

    // ── dispatch wiring + config ──

    static final class CapturingGateway extends Gateway {
        final java.util.List<String> sent = new java.util.ArrayList<>();
        final Config config;

        CapturingGateway(Config config) {
            super(config);
            this.config = config;
        }

        @Override
        public void send(WebSocket conn, String json) {
            sent.add(json);
        }

        @Override
        public Config getConfig() {
            return config;
        }
    }

    static final class StubCtx implements CommandContext {

        @Override
        public boolean simEnabled() {
            return true;
        }
        final CapturingGateway gateway;

        StubCtx(Config config) {
            this.gateway = new CapturingGateway(config);
        }

        @Override
        public mage.remote.SessionImpl session() {
            return null;
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
            return ServerCapabilities.none();
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

    @Test
    void theVerbAnswersAResultEnvelopeAndIsNotGated() throws Exception {
        game(A, new byte[]{1, 2, 3});
        Config config = Config.parse(new String[]{"--wsPort", "0", "--simRoster", "none",
                "--replayDir", dir.toString()});
        StubCtx ctx = new StubCtx(config);
        // capabilities are the stock "none": the verb must STILL answer (no capability gate)
        assertFalse(ctx.capabilities().supportsLlm());
        assertTrue(ReplayFiles.handle("getReplayFiles", null, "r1", new JsonObject(), ctx));
        JsonObject res = JsonParser.parseString(ctx.gateway.sent.get(0)).getAsJsonObject();
        assertEquals("result", res.get("type").getAsString());
        assertEquals("getReplayFiles", res.get("action").getAsString());
        assertEquals("r1", res.get("requestId").getAsString());
        assertTrue(res.get("ok").getAsBoolean());
        JsonObject data = res.getAsJsonObject("data");
        assertTrue(data.get("exists").getAsBoolean());
        assertEquals(A, data.getAsJsonArray("files").get(0).getAsJsonObject().get("gameId").getAsString());
    }

    @Test
    void anUnknownActionIsNotClaimedByTheHandler() {
        StubCtx ctx = new StubCtx(Config.parse(new String[]{"--wsPort", "0", "--simRoster", "none"}));
        assertFalse(ReplayFiles.handle("getFinishedMatches", null, "r1", new JsonObject(), ctx));
    }

    @Test
    void replayDirDefaultsToSavedAndTrims() {
        assertEquals("saved", Config.parse(new String[0]).getReplayDir());
        assertEquals("saved", Config.DEFAULT_REPLAY_DIR);
        assertEquals("/tmp/replays",
                Config.parse(new String[]{"--replayDir", "  /tmp/replays  "}).getReplayDir());
    }
}
