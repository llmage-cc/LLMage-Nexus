package org.mage.proxy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * Dispatch gate: a request that carries LLM wire content (llmConfigs, a COMPUTER_LLM seat)
 * against a connected server that reported no llm capability is rejected with the typed
 * {@code CAPABILITY_UNAVAILABLE} error BEFORE any server RPC — Fail Fast, never a silent drop
 * and never the generic {@code error} frame. The web hides the controls meanwhile, so both
 * sides agree on what is available.
 */
final class CapabilityGate {

    private CapabilityGate() {
    }

    /** The typed rejection the gate answers with (English, like every protocol error). */
    static final String LLM_UNAVAILABLE_MESSAGE =
            "The connected XMage server does not support LLM players — LLM seats and per-seat "
                    + "LLM configuration are unavailable on it";

    /**
     * True when a create request carries LLM wire content: any non-null llmConfigs entry or a
     * COMPUTER_LLM seat in playerTypes. A null-only llmConfigs array is padding (aligned to no
     * LLM seat), not content.
     */
    static boolean carriesLlmContent(JsonObject args) {
        if (args.has("llmConfigs") && args.get("llmConfigs").isJsonArray()) {
            for (JsonElement e : args.getAsJsonArray("llmConfigs")) {
                if (e != null && !e.isJsonNull()) {
                    return true;
                }
            }
        }
        if (!args.has("playerTypes") || !args.get("playerTypes").isJsonArray()) {
            return false;
        }
        for (JsonElement e : args.getAsJsonArray("playerTypes")) {
            if (e != null && e.isJsonPrimitive() && "COMPUTER_LLM".equalsIgnoreCase(e.getAsString())) {
                return true;
            }
        }
        return false;
    }

    /** True when a join request names a COMPUTER_LLM seat. */
    static boolean isLlmPlayerType(String raw) {
        return raw != null && "COMPUTER_LLM".equalsIgnoreCase(raw);
    }

    /** The typed rejection of a fork-only replay action against a server without the scrubber. */
    static final String REPLAY_UNAVAILABLE_MESSAGE =
            "The connected XMage server does not support the replay scrubber (fork-only seek) — "
                    + "seeking within a replay is unavailable on it";

    /** The typed rejection of a player action while a replay is loaded (no seat in a replay). */
    static final String REPLAY_PLAYER_ACTION_MESSAGE =
            "A replay is loaded — player actions are not available until the replay is stopped";

    /**
     * Gate for the fork-only replay scrubber action. Rejects with the typed capability error
     * when the connected server reported no {@code replayScrubber} capability (which rides
     * {@code llm}). False = the request may proceed.
     */
    static boolean rejectReplayScrubberWithoutCapability(CommandContext ctx, org.java_websocket.WebSocket conn,
                                                         String action, String requestId) {
        if (ctx.capabilities().replayScrubber) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, REPLAY_UNAVAILABLE_MESSAGE));
        return true;
    }

    /**
     * Gate for player-action verbs while a replay is loaded. A replay is a spectator-style
     * channel with no seat: the Fail Fast gate refuses the action before any server RPC. False =
     * the request may proceed.
     */
    static boolean rejectPlayerActionDuringReplay(CommandContext ctx, org.java_websocket.WebSocket conn,
                                                  String action, String requestId) {
        if (!ctx.replayActive()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, REPLAY_PLAYER_ACTION_MESSAGE));
        return true;
    }

    /**
     * Gate for createTable / createTournamentTable. Rejects when the request carries LLM
     * content and the connected server reported no llm capability. False = the request may
     * proceed.
     */
    static boolean rejectCreateWithoutLlm(JsonObject args, CommandContext ctx, org.java_websocket.WebSocket conn,
                                           String action, String requestId) {
        if (!carriesLlmContent(args) || ctx.capabilities().supportsLlm()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, LLM_UNAVAILABLE_MESSAGE));
        return true;
    }

    /**
     * Gate for joinTable / joinTournamentTable. Rejects an LLM seat join against a server
     * without the llm capability. False = the request may proceed.
     */
    static boolean rejectJoinWithoutLlm(String playerType, CommandContext ctx, org.java_websocket.WebSocket conn,
                                        String action, String requestId) {
        if (!isLlmPlayerType(playerType) || ctx.capabilities().supportsLlm()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, LLM_UNAVAILABLE_MESSAGE));
        return true;
    }

    /** The typed rejection of an LLM list verb against a server without the llm capability. */
    static final String LLM_LIST_UNAVAILABLE_MESSAGE =
            "The connected XMage server does not support LLM players — there is no LLM model or "
                    + "personality list to fetch from it";

    /**
     * Gate for the LLM list verbs ({@code fetchModels} / {@code fetchPersonalities}). Rejects
     * FIRST, before any work (a network call for models), with the typed {@code models_error} /
     * {@code personalities_error} frame when the connected server reported no llm capability.
     * False = the request may proceed.
     */
    static boolean rejectLlmListWithoutCapability(CommandContext ctx, org.java_websocket.WebSocket conn,
                                                  String action, String requestId, String errorFrame) {
        if (ctx.capabilities().supportsLlm()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.typedErrorJson(errorFrame, action, requestId,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, LLM_LIST_UNAVAILABLE_MESSAGE));
        return true;
    }

    /** The typed rejection of a client-key bridge reply against a server without the llm capability. */
    static final String LLM_BRIDGE_UNAVAILABLE_MESSAGE =
            "The connected XMage server does not support client-key LLM seats — there is no LLM "
                    + "prompt bridge to answer on it";

    /** The typed rejection of the P1 deck-list verb against a server without the p1 capability. */
    static final String P1_UNAVAILABLE_MESSAGE =
            "The connected XMage server does not support P1 training-deck seats — there is no "
                    + "training-deck list to fetch from it";

    /**
     * Gate for the P1 deck-list verb ({@code getP1Decks}). Rejects FIRST, before
     * any work, with the typed {@code CAPABILITY_UNAVAILABLE} when the connected server reported no
     * {@code p1} capability (its {@code playerTypes} lacked {@code COMPUTER_P1}). False = proceed.
     */
    static boolean rejectP1WithoutCapability(CommandContext ctx, org.java_websocket.WebSocket conn,
                                             String action, String requestId) {
        if (ctx.capabilities().supportsP1()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, P1_UNAVAILABLE_MESSAGE));
        return true;
    }

    /**
     * Gate for the client-key bridge reply verbs ({@code llm_decision} / {@code llm_error}).
     * Rejects FIRST, before any RPC, with the typed {@code CAPABILITY_UNAVAILABLE} when the
     * connected server reported no llm capability. False = the request may proceed.
     */
    static boolean rejectLlmBridgeWithoutCapability(CommandContext ctx, org.java_websocket.WebSocket conn,
                                                    String action, String requestId) {
        if (ctx.capabilities().supportsLlm()) {
            return false;
        }
        ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, LLM_BRIDGE_UNAVAILABLE_MESSAGE));
        return true;
    }
}
