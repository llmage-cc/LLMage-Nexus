package org.mage.proxy;

import java.util.Locale;

/** Clasificación de errores del servidor a errorCode uniforme + limpieza de prefijos. */
final class ErrorClassifier {

    private ErrorClassifier() {
    }

    static String classifyErrorCode(String detail) {
        if (detail == null) return ProxyProtocol.ERR_FAILED;
        String lower = detail.toLowerCase(Locale.ROOT);
        if (lower.contains("wrong client version") || lower.contains("mageversionexception")) return ProxyProtocol.ERR_VERSION_MISMATCH;
        if (lower.contains("card not found")) return ProxyProtocol.ERR_CARD_NOT_FOUND;
        if (lower.contains("quit ratio")) return ProxyProtocol.ERR_QUIT_RATIO;
        if (lower.contains("minimum rating") || lower.contains("rating") && lower.contains("lower")) return ProxyProtocol.ERR_RATING;
        if (lower.contains("not started tables") || lower.contains("too much") || lower.contains("already") && lower.contains("not started")) return ProxyProtocol.ERR_TABLE_LIMIT;
        if (lower.contains("invalid deck") || lower.contains("deckvalidator") || lower.contains("no valid deck") || lower.contains("must contain") || lower.contains("too few cards") || lower.contains("deck is not valid")
                || lower.contains("too powerful") || lower.contains("power level") || lower.contains("requested no") || lower.contains("appropriate for the selected format") || lower.contains("select a deck that is appropriate")
                || lower.contains("no valid deck selected")) return ProxyProtocol.ERR_INVALID_DECK;
        if (lower.contains("wrong password") || lower.contains("invalid password") || lower.contains("password")) return ProxyProtocol.ERR_PASSWORD;
        if (lower.contains("no available seats") || lower.contains("table is full") || lower.contains("can join a table only")) return ProxyProtocol.ERR_SEAT;
        if (lower.contains("player can't join")) return ProxyProtocol.ERR_SEAT;
        if (lower.contains("could not create player")) return ProxyProtocol.ERR_FAILED;
        if (lower.contains("decktype") || lower.contains("deck type") || lower.contains("invalid deck type")) return ProxyProtocol.ERR_INVALID_DECK_TYPE;
        if (lower.contains("gametype") || lower.contains("game type") || lower.contains("invalid game type")) return ProxyProtocol.ERR_INVALID_GAME_TYPE;
        return ProxyProtocol.ERR_FAILED;
    }

    /**
     * The code for a refused login. A specific class wins when the reason matches one; a bare
     * {@code FAILED} (the proxy captured no reason at all) stays {@code FAILED}; any other text
     * is the server's own explanation, so it answers {@link ProxyProtocol#ERR_SERVER_MESSAGE} —
     * that way the web keeps showing the text and can tell "refused, here is why" from
     * "refused, no reason". The 14-character username limit
     * ({@code User name may not be longer than 14 characters}) is the case that exposed it.
     */
    static String classifyLoginFailure(String detail) {
        String code = classifyErrorCode(detail);
        if (!ProxyProtocol.ERR_FAILED.equals(code)) return code;
        return hasServerText(detail) ? ProxyProtocol.ERR_SERVER_MESSAGE : ProxyProtocol.ERR_FAILED;
    }

    /** True when the detail is a real message, not the proxy's own "nothing captured" sentinel. */
    private static boolean hasServerText(String detail) {
        if (detail == null) return false;
        String text = detail.trim();
        return !text.isEmpty()
                && !text.equalsIgnoreCase(ProxyProtocol.ERR_FAILED)
                && !text.equalsIgnoreCase("No message");
    }

    static String stripServerErrorPrefix(String msg) {
        if (msg == null) return null;
        if (msg.startsWith("Server error: ")) return msg.substring("Server error: ".length());
        if (msg.startsWith("Remote task error: ")) return msg.substring("Remote task error: ".length());
        return msg;
    }
}
