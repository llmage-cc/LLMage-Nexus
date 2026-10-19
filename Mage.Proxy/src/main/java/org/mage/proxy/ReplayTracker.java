package org.mage.proxy;

import java.util.UUID;

/**
 * Per-session replay bookkeeping: whether a replay is loaded (the player-action gate), which
 * game it drives, and the track length of the last frame this session forwarded — the input of
 * the local range check in front of {@code seekTo} (an out-of-range seek makes the server throw
 * with no answer to the client, measured).
 */
final class ReplayTracker {

    private volatile boolean active = false;
    private volatile UUID gameId = null;
    private volatile int stateCount = -1;

    /** A replay was loaded or started: from here on player actions are refused. */
    void loaded(UUID gameId) {
        this.gameId = gameId;
        this.stateCount = -1;
        this.active = true;
    }

    /** A REPLAY_INIT/REPLAY_UPDATE frame was forwarded: refresh the track length it carries. */
    void frame(UUID gameId, int replayStateCount) {
        if (gameId != null) {
            this.gameId = gameId;
        }
        this.active = true;
        if (replayStateCount > 0) {
            this.stateCount = replayStateCount;
        }
    }

    /**
     * A REPLAY_DONE was forwarded. A boundary ("end of replay") keeps the session alive so the
     * user can step back; anything else ("stopped replay", a corrupt file) ends it.
     */
    void done(boolean boundary) {
        if (!boundary) {
            clear();
        }
    }

    boolean isActive() {
        return active;
    }

    UUID gameId() {
        return gameId;
    }

    /** The last forwarded track length, or -1 while unknown (forward and accept the server's). */
    int stateCount() {
        return stateCount;
    }

    void clear() {
        active = false;
        gameId = null;
        stateCount = -1;
    }
}
