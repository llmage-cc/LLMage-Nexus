package org.mage.proxy;

import com.google.gson.JsonObject;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;

import java.util.UUID;

/** Superficie de ProxyClient que necesitan los handlers de comandos por dominio. */
interface CommandContext {

    SessionImpl session();

    Gateway gateway();

    boolean isConnected();

    /**
     * The capabilities of the connected XMage server (probed once at login). Keeps the stock
     * answer before any probe, so every LLM-carrying request is rejected while no server
     * capability is known — the fail-fast input of the dispatch gate.
     */
    ServerCapabilities capabilities();

    /**
     * True while a replay is loaded or playing in this server session: player-action verbs are
     * then refused before any RPC (a replay carries no seat). Cleared on a non-boundary
     * {@code REPLAY_DONE}.
     */
    boolean replayActive();

    /** Track length of the last forwarded replay frame, or -1 while unknown (local range check). */
    int replayStateCount();

    /** True when a live game is being played or watched right now (replayGame refuses then). */
    boolean liveGameActive();

    /** A replay was loaded or started: player actions are refused from here on. */
    void markReplayActive(UUID gameId);

    /** The replay ended (stop, exit or corrupt file): the player-action gate is lifted. */
    void clearReplay();

    void sendFailure(WebSocket conn, String action, String requestId, long start);

    void replayGameState(WebSocket conn, UUID gameId);

    /** Lets the session forward events of a game it (re)joined or watches. */
    void markGameActive(UUID gameId);

    /** The player left or stopped watching the game. */
    void markGameInactive(UUID gameId);

    /**
     * Takes the cached open prompt of a game out before the player's answer is sent (only a
     * GAME_SELECT when {@code onlySelect}); null when there is none.
     */
    ReplayCache.Prompt takePrompt(UUID gameId, boolean onlySelect);

    /** The answer was rejected, so the prompt is still open. */
    void restorePrompt(UUID gameId, ReplayCache.Prompt prompt);

    void startSims(JsonObject args, UUID roomId, UUID tableId);

    /** Whether the dev-only proxy SIM bots are enabled ({@code --sim on}). */
    boolean simEnabled();
}
