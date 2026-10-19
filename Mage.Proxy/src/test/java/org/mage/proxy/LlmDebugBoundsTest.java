package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link LlmDebugBounds} bounds the live {@code llmDebug} transcript on the wire while the
 * replay cache keeps the frame whole.
 */
class LlmDebugBoundsTest {

    private static final UUID GAME = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

    // ── pure helper ────────────────────────────────────────────────────────────

    private static String frameWithLlmDebug(JsonArray llmDebug) {
        JsonObject data = new JsonObject();
        data.addProperty("turn", 3);
        data.add("llmDebug", llmDebug);
        JsonObject ev = new JsonObject();
        ev.addProperty("type", "event");
        ev.addProperty("method", "GAME_UPDATE");
        ev.addProperty("messageId", 1);
        ev.add("data", data);
        return ev.toString();
    }

    private static JsonObject conversation(String playerName, int messageCount) {
        JsonArray messages = new JsonArray();
        for (int i = 0; i < messageCount; i++) {
            JsonObject m = new JsonObject();
            m.addProperty("role", i % 2 == 0 ? "user" : "assistant");
            m.addProperty("content", "m" + i);
            messages.add(m);
        }
        JsonObject conv = new JsonObject();
        conv.addProperty("playerName", playerName);
        conv.addProperty("modelName", "model-x");
        conv.addProperty("exchangeCount", messageCount);
        conv.add("messages", messages);
        return conv;
    }

    private static JsonObject conversation(String playerName, int messageCount, int contentChars) {
        JsonArray messages = new JsonArray();
        for (int i = 0; i < messageCount; i++) {
            JsonObject m = new JsonObject();
            m.addProperty("role", i % 2 == 0 ? "user" : "assistant");
            m.addProperty("content", "x".repeat(contentChars) + i);
            messages.add(m);
        }
        JsonObject conv = new JsonObject();
        conv.addProperty("playerName", playerName);
        conv.addProperty("modelName", "model-x");
        conv.addProperty("exchangeCount", messageCount);
        conv.add("messages", messages);
        return conv;
    }

    /**
     * E2: a conversation of FEW but individually very large messages sits under the count cap
     * ({@link LlmDebugBounds#LLM_DEBUG_MAX_MESSAGES}, 40) yet must still be bounded BY BYTES.
     */
    @Test
    void aFewVeryLargeMessagesAreBoundedByBytesNotJustCount() {
        // 30 messages (< LLM_DEBUG_MAX_MESSAGES) of ~20 KB each => ~600 KB frame.
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 30, 20_000));
        String full = frameWithLlmDebug(dbg);
        String bounded = LlmDebugBounds.boundLlmDebug(full, ClientCallbackMethod.GAME_UPDATE);
        int msgsBytes = messagesBytes(bounded, 0);
        System.out.println("[E2] full=" + full.length() + " bounded=" + bounded.length()
                + " messages=" + msgsBytes + " budget=" + LlmDebugBounds.LLM_DEBUG_MAX_BYTES);
        assertEquals(64 * 1024, LlmDebugBounds.LLM_DEBUG_MAX_BYTES, "the shipped byte budget");
        assertTrue(msgsBytes <= LlmDebugBounds.LLM_DEBUG_MAX_BYTES,
                "the live messages array must fit the byte budget: " + msgsBytes + " > " + LlmDebugBounds.LLM_DEBUG_MAX_BYTES);
        assertTrue(bounded.length() < full.length() / 5,
                "the live frame must shed the bloat: " + bounded.length() + " vs " + full.length());
        JsonObject conv = llmDebugConversation(bounded, 0);
        JsonArray msgs = conv.getAsJsonArray("messages");
        assertEquals("x".repeat(20_000) + "29", msgs.get(msgs.size() - 1).getAsJsonObject().get("content").getAsString(),
                "the NEWEST message survives the byte trim");
        assertTrue(conv.get(LlmDebugBounds.MESSAGES_HIDDEN_FIELD).getAsInt() > 0,
                "the dropped older messages are reported via messagesHidden");
    }

    /** E2: the bound is driven by message SIZE — a conversation under the budget keeps its full tail. */
    @Test
    void theByteBoundIsIndependentOfMessageSize() {
        JsonArray small = new JsonArray();
        small.add(conversation("A", 30, 1_000)); // ~31 KB, under the 64 KiB budget
        assertEquals(30, boundMessages(small).size(), "a conversation under the byte budget keeps every message");

        JsonArray big = new JsonArray();
        big.add(conversation("A", 30, 20_000)); // ~600 KB, over budget
        assertTrue(boundMessages(big).size() < 30, "a conversation over the byte budget drops older messages");
    }

    /** E2: a single message larger than the budget is TRUNCATED, never dropped — the live decision survives. */
    @Test
    void aSingleOversizedMessageIsTruncatedNotDropped() {
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 1, 200_000)); // one ~200 KB message
        String full = frameWithLlmDebug(dbg);
        String bounded = LlmDebugBounds.boundLlmDebug(full, ClientCallbackMethod.GAME_UPDATE);

        assertTrue(messagesBytes(bounded, 0) <= LlmDebugBounds.LLM_DEBUG_MAX_BYTES,
                "the single oversized message must still fit the budget: " + messagesBytes(bounded, 0));
        JsonObject conv = llmDebugConversation(bounded, 0);
        JsonArray msgs = conv.getAsJsonArray("messages");
        assertEquals(1, msgs.size(), "the single message is kept, not dropped");
        assertFalse(conv.has(LlmDebugBounds.MESSAGES_HIDDEN_FIELD), "nothing was dropped");
        String content = msgs.get(0).getAsJsonObject().get("content").getAsString();
        assertTrue(content.length() < 200_000 && content.length() > 0, "the content was truncated, not emptied");
        assertTrue(content.endsWith("…"), "the truncation is marked in the content");
    }

    private static JsonArray llmDebugArray(String frameJson) {
        return JsonParser.parseString(frameJson).getAsJsonObject().getAsJsonObject("data").getAsJsonArray("llmDebug");
    }

    private static int messagesBytes(String frameJson, int convIndex) {
        return llmDebugConversation(frameJson, convIndex).getAsJsonArray("messages").toString().length();
    }

    private static JsonObject llmDebugConversation(String frameJson, int index) {
        return llmDebugArray(frameJson).get(index).getAsJsonObject();
    }

    private static JsonArray boundMessages(JsonArray dbg) {
        return llmDebugConversation(LlmDebugBounds.boundLlmDebug(frameWithLlmDebug(dbg), ClientCallbackMethod.GAME_UPDATE), 0)
                .getAsJsonArray("messages");
    }

    @Test
    void aShortConversationPassesThroughByteIdentical() {
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 5));
        String json = frameWithLlmDebug(dbg);
        // same instance => no reformat, no reorder, no added field
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_UPDATE));
    }

    @Test
    void aLongConversationIsTrimmedToTheLastNAndMarked() {
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 120));
        dbg.add(conversation("B", 10)); // a second, short conversation is untouched
        String json = frameWithLlmDebug(dbg);

        JsonObject ev = JsonParser.parseString(LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_UPDATE)).getAsJsonObject();
        JsonArray out = ev.getAsJsonObject("data").getAsJsonArray("llmDebug");
        assertEquals(2, out.size(), "every conversation entry is kept");
        assertEquals(3, ev.getAsJsonObject("data").get("turn").getAsInt(), "every other field is kept");

        JsonObject a = out.get(0).getAsJsonObject();
        JsonArray aMsgs = a.getAsJsonArray("messages");
        assertEquals(LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES, aMsgs.size());
        assertEquals("m" + (120 - LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES), aMsgs.get(0).getAsJsonObject().get("content").getAsString(),
                "the LAST N messages are kept");
        assertEquals("m119", aMsgs.get(aMsgs.size() - 1).getAsJsonObject().get("content").getAsString());
        assertEquals(120 - LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES, a.get(LlmDebugBounds.MESSAGES_HIDDEN_FIELD).getAsInt());
        assertEquals("model-x", a.get("modelName").getAsString(), "the conversation item keeps its other fields");

        JsonObject b = out.get(1).getAsJsonObject();
        assertEquals(10, b.getAsJsonArray("messages").size(), "a short conversation is not touched");
        assertFalse(b.has(LlmDebugBounds.MESSAGES_HIDDEN_FIELD));
    }

    @Test
    void aNonLiveCallbackIsNeverBounded() {
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 500));
        String json = frameWithLlmDebug(dbg);
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_TARGET));
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.CHATMESSAGE));
        assertTrue(LlmDebugBounds.isLiveGameFrame(ClientCallbackMethod.GAME_INIT));
        assertTrue(LlmDebugBounds.isLiveGameFrame(ClientCallbackMethod.GAME_UPDATE_AND_INFORM));
    }

    @Test
    void aFrameWithoutLlmDebugIsLeftAlone() {
        String json = "{\"type\":\"event\",\"method\":\"GAME_UPDATE\",\"messageId\":1,\"data\":{\"turn\":3}}";
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_UPDATE));
    }

    /**
     * The common live frame carries no transcript at all, so the substring pre-check must skip
     * the JsonParser pass (a GameView frame is ~200 KB of JSON) and hand back the SAME string
     * instance, exactly as the parsed path did before the pre-check existed.
     */
    @Test
    void aFrameWithoutTheLlmDebugKeySkipsTheParseAndPassesThroughIdentical() {
        StringBuilder big = new StringBuilder(
                "{\"type\":\"event\",\"method\":\"GAME_UPDATE\",\"messageId\":1,\"data\":{\"turn\":3,\"log\":\"");
        for (int i = 0; i < 20_000; i++) {
            big.append('x');
        }
        big.append("\"}}");
        String json = big.toString();
        assertTrue(json.length() > 20_000, "the frame is a realistic large GameView payload");
        assertFalse(json.contains("llmDebug"), "the frame carries no llmDebug key anywhere");
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_UPDATE));
    }

    @Test
    void aNullLlmDebugFieldIsLeftAlone() {
        String json = "{\"type\":\"event\",\"method\":\"GAME_UPDATE\",\"messageId\":1,\"data\":{\"llmDebug\":null}}";
        assertSame(json, LlmDebugBounds.boundLlmDebug(json, ClientCallbackMethod.GAME_UPDATE));
    }

    @Test
    void aFiveHundredMessageConversationStaysBounded() {
        JsonArray dbg = new JsonArray();
        dbg.add(conversation("A", 500));
        String full = frameWithLlmDebug(dbg);
        String bounded = LlmDebugBounds.boundLlmDebug(full, ClientCallbackMethod.GAME_UPDATE);
        JsonArray msgs = JsonParser.parseString(bounded).getAsJsonObject().getAsJsonObject("data").getAsJsonArray("llmDebug")
                .get(0).getAsJsonObject().getAsJsonArray("messages");
        assertEquals(LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES, msgs.size());
        assertTrue(bounded.length() < full.length() / 5,
                "the live frame stays a small fraction of the full transcript (" + bounded.length() + " vs " + full.length() + ")");
    }

    // ── end-to-end: the SEND site trims, the replay cache does not ─────────────

    /** Minimal stand-in for a serialized GameView carrying a bounded-worthy transcript. */
    static final class Msg {
        String role;
        String content;

        Msg(String role, String content) {
            this.role = role;
            this.content = content;
        }
    }

    static final class Conv {
        String playerName;
        String modelName = "model-x";
        List<Msg> messages;

        Conv(String playerName, int messageCount) {
            this.playerName = playerName;
            this.messages = new ArrayList<>();
            for (int i = 0; i < messageCount; i++) {
                messages.add(new Msg(i % 2 == 0 ? "user" : "assistant", "m" + i));
            }
        }
    }

    static final class FakeGameView {
        int turn = 3;
        List<Conv> llmDebug;

        FakeGameView(List<Conv> llmDebug) {
            this.llmDebug = llmDebug;
        }
    }

    static final class Sent {
        final WebSocket conn;
        final JsonObject frame;

        Sent(WebSocket conn, String json) {
            this.conn = conn;
            this.frame = JsonParser.parseString(json).getAsJsonObject();
        }
    }

    static final class RecordingGateway extends Gateway {
        final List<Sent> sent = new ArrayList<>();

        RecordingGateway() {
            super(Config.parse(new String[]{"--wsPort", "0", "--simRoster", "none"}));
        }

        @Override
        public synchronized void send(WebSocket conn, String json) {
            sent.add(new Sent(conn, json));
        }

        synchronized List<JsonObject> to(WebSocket conn) {
            return sent.stream().filter(s -> s.conn == conn).map(s -> s.frame).collect(Collectors.toList());
        }
    }

    private final RecordingGateway gateway = new RecordingGateway();
    private final ProxyClient client = new ProxyClient(gateway.getConfig(), gateway);

    @AfterEach
    void stop() {
        client.shutdown();
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

    private List<JsonObject> events(WebSocket conn, int expected) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        List<JsonObject> out;
        do {
            out = gateway.to(conn).stream()
                    .filter(f -> f.has("type") && "event".equals(f.get("type").getAsString()))
                    .collect(Collectors.toList());
            if (out.size() >= expected) {
                return out;
            }
            Thread.sleep(10);
        } while (System.currentTimeMillis() < deadline);
        return out;
    }

    private static JsonArray messages(JsonObject event) {
        return event.getAsJsonObject("data").getAsJsonArray("llmDebug").get(0).getAsJsonObject().getAsJsonArray("messages");
    }

    @Test
    void theLiveFrameIsTrimmedButTheReplayCacheKeepsTheWholeTranscript() throws Exception {
        client.markGameActive(GAME);
        WebSocket first = conn();
        client.attach(first, "1", null, -1);

        List<Conv> convs = new ArrayList<>();
        convs.add(new Conv("A", 120));
        ClientCallback cb = new ClientCallback(ClientCallbackMethod.GAME_UPDATE, GAME);
        // compress=false: the 3-arg constructor would gzip a ZippedObject, and our stub is not a
        // server view; processCallback only needs getData() to carry the view.
        cb.setData(new FakeGameView(convs), false);
        cb.setMessageId(1);
        client.onCallback(cb);

        List<JsonObject> live = events(first, 1);
        assertEquals(1, live.size(), "the live GAME_UPDATE reached the browser");
        assertEquals(LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES, messages(live.get(0)).size(), "the live frame is bounded");
        assertEquals(120 - LlmDebugBounds.LLM_DEBUG_MAX_MESSAGES,
                live.get(0).getAsJsonObject("data").getAsJsonArray("llmDebug").get(0).getAsJsonObject()
                        .get(LlmDebugBounds.MESSAGES_HIDDEN_FIELD).getAsInt());

        WebSocket rejoin = conn();
        client.replayGameState(rejoin, GAME);
        List<JsonObject> rejoinFrames = gateway.to(rejoin);
        JsonObject replayed = rejoinFrames.stream()
                .filter(f -> f.has("type") && "event".equals(f.get("type").getAsString()))
                .findFirst().orElseThrow(() -> new AssertionError("no replayed frame; got " + rejoinFrames));
        assertTrue(replayed.has("data"), "replayed frame carries no data: " + replayed);
        assertEquals(120, messages(replayed).size(), "the replay cache kept the untrimmed transcript");
        assertFalse(replayed.getAsJsonObject("data").getAsJsonArray("llmDebug").get(0).getAsJsonObject()
                .has(LlmDebugBounds.MESSAGES_HIDDEN_FIELD), "the replay frame is not marked as trimmed");
    }
}
