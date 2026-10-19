package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import mage.players.PlayerType;
import mage.remote.SessionImpl;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Capabilities of the connected XMage server, probed right after {@code connectStart} returned
 * true (the handshake populated {@code ServerState} by then).
 *
 * <p>The proxy serves features that only exist on LLMage servers (LLM seats + per-seat config,
 * P1 seats, the replay scrubber's seekTo, replay sidecar metadata). Against a stock XMage
 * server those must fully deactivate: the web hides them and the proxy's dispatch gate
 * rejects requests that carry their wire content. The probe is honest by construction —
 * everything derives from what the server itself reports (its {@code PlayerType[]} via
 * ServerState, its {@code MageVersion}), never from assumptions about the target address.
 *
 * <p>Shipped on the connect result as {@code data.capabilities} (login and attach), absent on
 * failure. Missing capabilities in a client means "old proxy / stock server": all features hide.
 */
final class ServerCapabilities {

    final boolean llm;
    final boolean p1;
    final boolean replayScrubber;
    final boolean replaySidecar;
    final String serverVersion;
    final List<String> playerTypes;

    private ServerCapabilities(boolean llm, boolean p1, boolean replayScrubber, boolean replaySidecar,
                                String serverVersion, List<String> playerTypes) {
        this.llm = llm;
        this.p1 = p1;
        this.replayScrubber = replayScrubber;
        this.replaySidecar = replaySidecar;
        this.serverVersion = serverVersion;
        this.playerTypes = playerTypes;
    }

    /** Test seam: build explicit capabilities without a live session. */
    static ServerCapabilities forTest(boolean llm, boolean p1, boolean scrubber, boolean sidecar,
                                      String version, List<String> types) {
        return new ServerCapabilities(llm, p1, scrubber, sidecar, version,
                types == null ? new ArrayList<String>() : new ArrayList<>(types));
    }

    /** The stock-server answer, used when the probe cannot read the session at all. */
    static ServerCapabilities none() {
        return forTest(false, false, false, false, "unknown", new ArrayList<String>());
    }

    /**
     * Probes a connected session. Never throws: a session that cannot answer yields the
     * stock answer, so a probe failure hides LLM features instead of breaking the connect.
     */
    static ServerCapabilities probe(SessionImpl session) {
        List<PlayerType> types = null;
        try {
            PlayerType[] t = session.getPlayerTypes();
            types = t != null ? Arrays.asList(t) : null;
        } catch (Throwable e) {
            types = null;
        }
        boolean llm = types != null && types.contains(PlayerType.COMPUTER_LLM);
        boolean p1 = types != null && types.contains(PlayerType.COMPUTER_P1);
        // The scrubber (Replays.seekTo) and the sidecar metadata are LLMage additions with no
        // signal of their own in this release: the version string is identical on both
        // server kinds, so both ride the same LLMage signal as llm.
        boolean scrubber = llm;
        boolean sidecar = llm;
        List<String> names = new ArrayList<>();
        if (types != null) {
            for (PlayerType pt : types) {
                names.add(pt.name());
            }
        }
        return new ServerCapabilities(llm, p1, scrubber, sidecar, versionOf(session), names);
    }

    /**
     * The server's version text (e.g. "1.4.62-V1 (build: …)"), informational only: a session
     * that cannot report one yields "unknown" and never fails the connect.
     */
    private static String versionOf(SessionImpl session) {
        try {
            String info = session.getVersionInfo();
            if (info == null || info.trim().isEmpty() || info.startsWith("<")) {
                return "unknown";
            }
            String s = info.trim();
            int space = s.indexOf(' ');
            return space >= 0 ? s.substring(0, space) : s;
        } catch (Throwable t) {
            return "unknown";
        }
    }

    /** True when the server can run LLM seats. Gate for every LLM-carrying request. */
    boolean supportsLlm() {
        return llm;
    }

    /** True when the server can run COMPUTER_P1 (Argentum policy-net) seats. */
    boolean supportsP1() {
        return p1;
    }

    /** Adds the {@code capabilities} object to a connect result's data. */
    void addTo(JsonObject data) {
        JsonObject caps = new JsonObject();
        caps.addProperty("llm", llm);
        caps.addProperty("p1", p1);
        caps.addProperty("replayScrubber", replayScrubber);
        caps.addProperty("replaySidecar", replaySidecar);
        caps.addProperty("serverVersion", serverVersion);
        JsonArray types = new JsonArray();
        for (String t : playerTypes) {
            types.add(t);
        }
        caps.add("playerTypes", types);
        data.add("capabilities", caps);
    }
}
