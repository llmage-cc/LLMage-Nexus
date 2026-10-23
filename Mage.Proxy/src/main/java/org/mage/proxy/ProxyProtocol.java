package org.mage.proxy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Códigos de error uniformes y sobre de respuesta del protocolo JSON.
 */
final class ProxyProtocol {

    static final String ERR_BAD_JSON = "BAD_JSON";
    static final String ERR_NOT_AUTHORIZED = "NOT_AUTHORIZED";
    static final String ERR_GAME_ID_REQUIRED = "GAME_ID_REQUIRED";
    static final String ERR_INVALID_ARGUMENT = "INVALID_ARGUMENT";
    static final String ERR_UNKNOWN_ACTION = "UNKNOWN_ACTION";
    static final String ERR_FAILED = "FAILED";
    /**
     * A refused login whose reason is the server's own text and matches no specific class
     * (e.g. {@code User name may not be longer than 14 characters}): the web shows that text,
     * and this code tells it apart from a bare {@code FAILED} that carries no reason at all.
     */
    static final String ERR_SERVER_MESSAGE = "SERVER_MESSAGE";
    static final String ERR_QUIT_RATIO = "QUIT_RATIO";
    static final String ERR_RATING = "RATING";
    static final String ERR_INVALID_DECK = "INVALID_DECK";
    static final String ERR_CARD_NOT_FOUND = "CARD_NOT_FOUND";
    static final String ERR_TABLE_LIMIT = "TABLE_LIMIT";
    static final String ERR_INVALID_GAME_TYPE = "INVALID_GAME_TYPE";
    static final String ERR_INVALID_DECK_TYPE = "INVALID_DECK_TYPE";
    static final String ERR_PASSWORD = "PASSWORD";
    static final String ERR_SEAT = "SEAT";
    static final String ERR_WARMING_UP = "WARMING_UP";
    static final String ERR_VERSION_MISMATCH = "VERSION_MISMATCH";
    /**
     * The request carries LLM wire content (llmConfigs, a COMPUTER_LLM seat) but the connected
     * XMage server cannot run LLM players: rejected before any server RPC (fail fast).
     */
    static final String ERR_CAPABILITY_UNAVAILABLE = "CAPABILITY_UNAVAILABLE";

    private ProxyProtocol() {
    }

    static String resultJson(String action, String requestId, boolean ok, String errorCode, Object data) {
        JsonObject res = new JsonObject();
        res.addProperty("type", "result");
        res.addProperty("action", action);
        res.addProperty("requestId", requestId == null ? "" : requestId);
        res.addProperty("ok", ok);
        if (errorCode != null) {
            res.addProperty("errorCode", errorCode);
        }
        if (!ok) {
            if (data instanceof String) {
                res.addProperty("error", (String) data);
            } else if (data != null) {
                res.addProperty("error", JsonUtil.toJson(data));
            } else {
                res.addProperty("error", errorCode == null ? "Command failed" : errorCode);
            }
        } else if (data != null) {
            if (data instanceof JsonElement) {
                res.add("data", (JsonElement) data);
            } else if (data instanceof String) {
                res.addProperty("data", (String) data);
            } else {
                res.add("data", JsonParser.parseString(JsonUtil.toJson(data)));
            }
        }
        return res.toString();
    }

    /**
     * The connect-rejection frame the browser's connect form consumes: exactly
     * {@code {"type":"connect_error","message":<msg>}} (no requestId/ok — the form reads the message
     * and the 4401 close tells it not to auto-reconnect). Used by the deployment gates (bad auth
     * token, anon name collision) before any session is created.
     */
    static String connectErrorJson(String message) {
        JsonObject res = new JsonObject();
        res.addProperty("type", "connect_error");
        res.addProperty("message", message == null ? "" : message);
        return res.toString();
    }

    /**
     * A typed error frame for verbs whose success answer is NOT a {@code result} envelope but a
     * dedicated frame (the LLM list verbs: {@code models_error} / {@code personalities_error}).
     * The web consumer clears its loading flag only on a typed reply; a generic {@code error}
     * would leave it spinning forever, so these verbs never fall back to {@code error}.
     * Carries the errorCode and the player-facing message.
     */
    static String typedErrorJson(String frameType, String action, String requestId, String errorCode, String message) {
        JsonObject res = new JsonObject();
        res.addProperty("type", frameType);
        res.addProperty("action", action);
        res.addProperty("requestId", requestId == null ? "" : requestId);
        res.addProperty("ok", false);
        if (errorCode != null) {
            res.addProperty("errorCode", errorCode);
        }
        res.addProperty("message", message == null ? (errorCode == null ? "Command failed" : errorCode) : message);
        return res.toString();
    }
}
