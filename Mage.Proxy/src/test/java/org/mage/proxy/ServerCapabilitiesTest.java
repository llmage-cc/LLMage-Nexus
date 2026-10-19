package org.mage.proxy;

import com.google.gson.JsonObject;
import mage.players.PlayerType;
import mage.remote.SessionImpl;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The server-capabilities probe (derivation from the session's own ServerState) and the
 * wire shape shipped on every successful connect result.
 */
class ServerCapabilitiesTest {

    /** A session as connectStart leaves it: connected, with a ServerState to answer from. */
    static final class ProbeSession extends SessionImpl {
        PlayerType[] types;
        String version = "1.4.62-V1 (build: 2026-10-07T16:35:00Z)";

        ProbeSession(PlayerType[] types) {
            super(null);
            this.types = types;
        }

        @Override
        public PlayerType[] getPlayerTypes() {
            return types;
        }

        @Override
        public String getVersionInfo() {
            return version;
        }
    }

    /** A session that cannot answer: every probe field throws, like a torn-down link. */
    static final class DeafSession extends SessionImpl {
        DeafSession() {
            super(null);
        }

        @Override
        public PlayerType[] getPlayerTypes() {
            throw new IllegalStateException("link down");
        }

        @Override
        public String getVersionInfo() {
            throw new IllegalStateException("link down");
        }
    }

    @Test
    void computerLlmSeatEnablesLlmAndItsCompanionFlags() {
        ServerCapabilities caps = ServerCapabilities.probe(new ProbeSession(new PlayerType[]{
                PlayerType.HUMAN, PlayerType.COMPUTER_LLM}));
        assertTrue(caps.supportsLlm());
        assertFalse(caps.p1);
        // the scrubber (seekTo) and sidecar metadata are LLMage additions with no signal of
        // their own in this release: both ride the llm signal
        assertTrue(caps.replayScrubber);
        assertTrue(caps.replaySidecar);
        assertEquals("1.4.62-V1", caps.serverVersion);
        assertEquals(Arrays.asList("HUMAN", "COMPUTER_LLM"), caps.playerTypes);
    }

    @Test
    void computerP1SeatIsReportedIndependently() {
        ServerCapabilities caps = ServerCapabilities.probe(new ProbeSession(new PlayerType[]{
                PlayerType.HUMAN, PlayerType.COMPUTER_P1}));
        assertFalse(caps.supportsLlm());
        assertTrue(caps.p1);
    }

    @Test
    void stockServerYieldsNoLlmCapability() {
        ServerCapabilities caps = ServerCapabilities.probe(new ProbeSession(new PlayerType[]{
                PlayerType.HUMAN, PlayerType.COMPUTER_MAD}));
        assertFalse(caps.supportsLlm());
        assertEquals(Arrays.asList("HUMAN", "COMPUTER_MAD"), caps.playerTypes);
        assertEquals("1.4.62-V1", caps.serverVersion);
    }

    @Test
    void aSessionThatCannotAnswerDegradesToStockWithoutThrowing() {
        ServerCapabilities caps = ServerCapabilities.probe(new DeafSession());
        assertFalse(caps.supportsLlm());
        assertFalse(caps.supportsP1());
        assertFalse(caps.replayScrubber);
        assertEquals("unknown", caps.serverVersion);
        assertTrue(caps.playerTypes.isEmpty());
    }

    @Test
    void anUnconnectedSessionIsStockToo() {
        // serverState is null before a login: getPlayerTypes() NPEs and the probe must swallow it
        ServerCapabilities caps = ServerCapabilities.probe(new SessionImpl(null));
        assertFalse(caps.supportsLlm());
        assertEquals("unknown", caps.serverVersion);
    }

    @Test
    void aVersionPlaceholderNeverLeaksIntoTheWire() {
        ProbeSession s = new ProbeSession(new PlayerType[]{PlayerType.HUMAN});
        s.version = "<no server state>";
        assertEquals("unknown", ServerCapabilities.probe(s).serverVersion);
        s.version = "";
        assertEquals("unknown", ServerCapabilities.probe(s).serverVersion);
        s.version = null;
        assertEquals("unknown", ServerCapabilities.probe(s).serverVersion);
    }

    @Test
    void theWireShapeCarriesEveryContractField() {
        ServerCapabilities caps = ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1",
                Collections.singletonList("HUMAN"));
        JsonObject data = new JsonObject();
        caps.addTo(data);
        JsonObject wire = data.getAsJsonObject("capabilities");
        assertEquals(true, wire.get("llm").getAsBoolean());
        assertEquals(false, wire.get("p1").getAsBoolean());
        assertEquals(true, wire.get("replayScrubber").getAsBoolean());
        assertEquals(true, wire.get("replaySidecar").getAsBoolean());
        assertEquals("1.4.62-V1", wire.get("serverVersion").getAsString());
        assertEquals(1, wire.getAsJsonArray("playerTypes").size());
        assertEquals("HUMAN", wire.getAsJsonArray("playerTypes").get(0).getAsString());
    }

    @Test
    void theStockAnswerIsAllFalse() {
        ServerCapabilities none = ServerCapabilities.none();
        assertFalse(none.supportsLlm());
        assertFalse(none.supportsP1());
        assertFalse(none.replayScrubber);
        assertFalse(none.replaySidecar);
        assertEquals("unknown", none.serverVersion);
        assertTrue(none.playerTypes.isEmpty());
    }
}
