package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.util.List;

/**
 * {@code getP1Decks} — the P1 training-deck list for the web's New-Game seat picker.
 *
 * <p>Frozen contract:
 * <pre>
 * {"action":"getP1Decks","requestId":…,"args":{}} →
 *   {"type":"result","action":"getP1Decks","requestId":…,"ok":true,
 *    "data":{"decks":[{"name":…,"deck":…},…],"default":…}}
 * </pre>
 *
 * <p>Gated FIRST, before any work: a server whose {@code playerTypes} lacked {@code COMPUTER_P1}
 * answers the typed {@code CAPABILITY_UNAVAILABLE}. The data comes from the fork-only
 * {@code mage.cards.decks.P1DeckPool} behind the cached reflection seam {@link P1DeckSupport}
 * (absent in stock 1.4.62) — when the running class lacks it the verb answers the typed
 * {@code CAPABILITY_UNAVAILABLE} too, mirroring {@code replaySeek} / the client-key bridge.
 *
 * <p>Activity classification: a once-per-form-open read (the picker fetches the list when the seat
 * type flips to COMPUTER_P1), NOT a high-frequency poll — so it stays on the ORDINARY logged
 * activity path, exactly like the other list verbs ({@code getTables}, {@code getGameTypes}). It is
 * deliberately NOT added to {@code Activity.QUIET}.
 */
final class P1DeckCommands {

    private P1DeckCommands() {
    }

    static boolean handle(String action, WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        if (!"getP1Decks".equals(action)) {
            return false;
        }
        // Gate FIRST: before the reflection read.
        if (CapabilityGate.rejectP1WithoutCapability(ctx, conn, action, requestId)) {
            return true;
        }
        List<P1DeckSupport.Deck> decks = P1DeckSupport.decks();
        if (decks == null) {
            // fork-only P1DeckPool absent (stock build): typed capability error, never a raw throw
            ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                    ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, CapabilityGate.P1_UNAVAILABLE_MESSAGE));
            return true;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, true, null, payload(decks)));
        return true;
    }

    /**
     * Builds the {@code data} object: the deck rows plus the deterministic default name. Split out
     * so it can be unit-tested without a WebSocket.
     */
    static JsonObject payload(List<P1DeckSupport.Deck> decks) {
        JsonObject data = new JsonObject();
        JsonArray arr = new JsonArray();
        for (P1DeckSupport.Deck d : decks) {
            JsonObject row = new JsonObject();
            row.addProperty("name", d.name);
            row.addProperty("deck", d.deck);
            arr.add(row);
        }
        data.add("decks", arr);
        String def = P1DeckSupport.defaultDeckName();
        data.addProperty("default", def == null ? "" : def);
        return data;
    }
}
