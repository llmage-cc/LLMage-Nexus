package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.interfaces.callback.ClientCallbackMethod;

import java.util.Map;

/**
 * Bounds the LIVE {@code llmDebug} transcript a browser receives.
 *
 * <p>Every game frame used to carry the <b>entire</b> LLM conversation per seat, so a late-game
 * {@code GAME_UPDATE} grew with the whole reasoning transcript: frames bloated, and a fresh
 * spectator's {@code connect} could not complete while a heavy game ran.
 *
 * <p>Capping the message COUNT alone was not enough: a conversation of a few <b>very large</b>
 * messages still shipped a huge frame (measured live: peak ~187 KB). This helper therefore applies
 * two caps to each conversation's {@code messages} array — a count cap ({@link
 * #LLM_DEBUG_MAX_MESSAGES}) and a BYTE cap ({@link #LLM_DEBUG_MAX_BYTES}) — so the live frame is
 * decoupled from game length <b>and</b> from per-message size.
 *
 * <p>This helper trims only what goes to the browser for a <b>live</b> game frame. The proxy's
 * replay cache keeps the frame <b>untrimmed</b> (the replay LLM tab rebuilds the cumulative
 * history from those frames — see {@code web/src/state/replay.ts mergeReplayLLMFrames}), so the
 * trim site must be the SEND call, never {@code ReplayCache.onState}.
 *
 * <p>Additive and upstream-shaped: the field name ({@code llmDebug}) and the item shape are
 * preserved; only the trailing slice of each conversation's {@code messages} array is sent, plus
 * one optional marker field {@link #MESSAGES_HIDDEN_FIELD} telling the drawer how many older
 * messages were left behind. When nothing needs trimming the original serialized string is
 * returned unchanged, so a short conversation passes through byte-identical.
 */
final class LlmDebugBounds {

    /**
     * How many of the most recent messages per LLM conversation a LIVE game frame carries.
     *
     * <p>Chosen at 40: comfortably more than the drawer renders at once (the UI window is 50, so a
     * trimmed live frame is never window-clipped), yet small enough that a long reasoning
     * transcript cannot bloat every {@code GAME_UPDATE} — the live frame stays bounded regardless
     * of game length. The replay cache is deliberately NOT bounded by this.
     */
    static final int LLM_DEBUG_MAX_MESSAGES = 40;

    /**
     * Byte budget for one LIVE conversation's serialized {@code messages} array.
     *
     * <p>The count cap ({@link #LLM_DEBUG_MAX_MESSAGES}) is applied first; if the retained tail is
     * still larger than this, the OLDEST retained messages are dropped until the array fits. 64 KiB
     * sits well under the ~187 KB live frame peak that motivated this issue, so a handful of
     * individually very large messages (long reasoning blocks, compaction summaries) can no longer
     * bloat every {@code GAME_UPDATE}. A conversation whose messages are ordinary-sized stays far
     * below it and is passed through untouched. The replay cache is deliberately NOT bounded.
     */
    static final int LLM_DEBUG_MAX_BYTES = 64 * 1024;

    /** Additive, optional marker on a trimmed conversation: how many older messages were dropped. */
    static final String MESSAGES_HIDDEN_FIELD = "messagesHidden";

    /** Appended to a string field that had to be shortened (the single-message-over-budget case). */
    private static final String TRUNCATION_SUFFIX = "…";

    private LlmDebugBounds() {
    }

    /**
     * The three callbacks that carry a live game's {@code GameView} to the browser. The replay
     * callbacks ({@code REPLAY_*}) are a different path and are not bounded here.
     */
    static boolean isLiveGameFrame(ClientCallbackMethod m) {
        return m == ClientCallbackMethod.GAME_INIT
                || m == ClientCallbackMethod.GAME_UPDATE
                || m == ClientCallbackMethod.GAME_UPDATE_AND_INFORM;
    }

    /**
     * Returns an event frame whose {@code data.llmDebug} conversations keep at most their last
     * {@link #LLM_DEBUG_MAX_MESSAGES} messages AND at most {@link #LLM_DEBUG_MAX_BYTES} bytes of
     * them, or the SAME string instance when nothing needs trimming (a short conversation is passed
     * through byte-identical: no reordering, no reformatting). Every conversation entry and every
     * other field is preserved; a trimmed conversation also gains {@link #MESSAGES_HIDDEN_FIELD}.
     *
     * <p>A frame whose text does not contain the {@code "llmDebug"} key at all (the common live
     * frame) skips the JSON parse entirely via a substring pre-check and is returned as-is.
     */
    static String boundLlmDebug(String eventJson, ClientCallbackMethod method) {
        if (eventJson == null || !isLiveGameFrame(method)) {
            return eventJson;
        }
        // The overwhelming majority of live frames carry no llmDebug at all, and a GameView
        // frame is ~200 KB of JSON — a substring scan is far cheaper than parsing it. The literal
        // must match Gson's serialization of the field name exactly (a quoted key); a frame that
        // merely MENTIONS the key (e.g. inside a message string) still falls through to the full
        // parse, which then returns it unchanged.
        if (eventJson.indexOf("\"llmDebug\"") < 0) {
            return eventJson;
        }
        JsonElement parsed = JsonParser.parseString(eventJson);
        if (!parsed.isJsonObject()) {
            return eventJson;
        }
        JsonElement dataEl = parsed.getAsJsonObject().get("data");
        if (dataEl == null || !dataEl.isJsonObject()) {
            return eventJson;
        }
        JsonElement debugEl = dataEl.getAsJsonObject().get("llmDebug");
        if (debugEl == null || !debugEl.isJsonArray()) {
            return eventJson;
        }
        boolean trimmedAny = false;
        for (JsonElement convEl : debugEl.getAsJsonArray()) {
            if (!convEl.isJsonObject()) {
                continue;
            }
            JsonObject conv = convEl.getAsJsonObject();
            JsonElement messagesEl = conv.get("messages");
            if (messagesEl == null || !messagesEl.isJsonArray()) {
                continue;
            }
            JsonArray messages = messagesEl.getAsJsonArray();
            int total = messages.size();
            if (total == 0) {
                continue;
            }
            // (1) COUNT cap: keep only the most recent LLM_DEBUG_MAX_MESSAGES messages.
            int start = Math.max(0, total - LLM_DEBUG_MAX_MESSAGES);
            // (2) BYTE cap: from that tail, drop the OLDEST retained messages until the serialized
            // tail fits the budget, always keeping at least the single newest message.
            while (start < total - 1 && serializedLength(messages, start, total) > LLM_DEBUG_MAX_BYTES) {
                start++;
            }
            boolean truncatedNewest = false;
            if (start == total - 1 && serializedLength(messages, start, total) > LLM_DEBUG_MAX_BYTES) {
                // A single (the newest) message alone exceeds the budget. Never drop the live
                // decision: truncate the message's largest string field to fit instead, so the
                // frame stays bounded and remains valid JSON of the same shape. (The `content`
                // field is the large one in practice; the longest string field is chosen so a
                // compaction `compactSummary` is handled too.)
                JsonElement only = messages.get(start);
                if (only.isJsonObject()) {
                    truncatedNewest = truncateLongestStringToFit(only.getAsJsonObject(), LLM_DEBUG_MAX_BYTES - 2);
                }
            }
            if (start == 0 && !truncatedNewest) {
                continue; // nothing was trimmed: leave this conversation byte-identical
            }
            JsonArray tail = new JsonArray();
            for (int i = start; i < total; i++) {
                tail.add(messages.get(i));
            }
            // in-place replacement of the array member: the conversation object keeps every
            // other field, and the outer llmDebug array keeps every conversation entry.
            conv.add("messages", tail);
            int hidden = total - tail.size();
            if (hidden > 0) {
                conv.addProperty(MESSAGES_HIDDEN_FIELD, hidden);
            }
            trimmedAny = true;
        }
        return trimmedAny ? parsed.toString() : eventJson;
    }

    /** The serialized length of {@code messages[from..to)} — the exact payload the caps bound. */
    private static int serializedLength(JsonArray messages, int from, int to) {
        JsonArray tail = new JsonArray();
        for (int i = from; i < to; i++) {
            tail.add(messages.get(i));
        }
        return tail.toString().length();
    }

    /**
     * Shortens the message's longest string field until the message itself fits {@code budget}
     * bytes (the budget is the array's, minus its two brackets). Retries a few times because
     * JSON-escaping can expand control characters, so one pass may not be enough.
     *
     * @return true when the message was actually changed
     */
    private static boolean truncateLongestStringToFit(JsonObject message, int budget) {
        String longestKey = null;
        int longestLen = -1;
        for (Map.Entry<String, JsonElement> e : message.entrySet()) {
            JsonElement v = e.getValue();
            if (v.isJsonPrimitive() && v.getAsJsonPrimitive().isString()) {
                int len = v.getAsString().length();
                if (len > longestLen) {
                    longestLen = len;
                    longestKey = e.getKey();
                }
            }
        }
        if (longestKey == null || longestLen <= 0) {
            return false; // no large string field: this message cannot be the bloat source
        }
        boolean changed = false;
        for (int attempt = 0; attempt < 4 && message.toString().length() > budget; attempt++) {
            String value = message.get(longestKey).getAsString();
            int target = value.length() - (message.toString().length() - budget) - TRUNCATION_SUFFIX.length();
            if (target < 0) {
                target = 0;
            }
            String next = value.substring(0, Math.min(target, value.length())) + TRUNCATION_SUFFIX;
            if (next.equals(value)) {
                break;
            }
            message.addProperty(longestKey, next);
            changed = true;
        }
        return changed;
    }
}
