package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the deployment gates that run in {@link Gateway#handleConnect} BEFORE any session
 * dial — the auth token (typed connect_error + 4401 close; attach does not bypass), the pinned
 * target, and the anon name guard. Also {@link ProxyClient#userIdStr}.
 */
class GatewayDeploymentGateTest {

    private DeckValidation.State priorState;

    @BeforeEach
    void readyDb() {
        // reach the pre-dial gates past the warming-up guard without a ~10 s card scan
        priorState = DeckValidation.setStateForTest(DeckValidation.State.READY);
        AnonNameGuard.shared().reset();
    }

    @AfterEach
    void restore() {
        DeckValidation.setStateForTest(priorState);
        AnonNameGuard.shared().reset();
    }

    /** A WebSocket double recording what was sent and whether/with which code it was closed. */
    static final class FakeConn {
        final List<String> sent = new ArrayList<>();
        volatile int closeCode = -1;
        volatile String closeReason = null;
        volatile boolean open = true;

        WebSocket ws() {
            return (WebSocket) Proxy.newProxyInstance(WebSocket.class.getClassLoader(),
                    new Class<?>[]{WebSocket.class}, (proxy, method, args) -> {
                        switch (method.getName()) {
                            case "send":
                                sent.add((String) args[0]);
                                return null;
                            case "close":
                                if (args != null && args.length >= 2 && args[0] instanceof Integer) {
                                    closeCode = (Integer) args[0];
                                    closeReason = (String) args[1];
                                }
                                open = false;
                                return null;
                            case "isOpen":
                                return open;
                            case "equals":
                                return proxy == args[0];
                            case "hashCode":
                                return System.identityHashCode(proxy);
                            default:
                                return method.getReturnType() == boolean.class ? Boolean.FALSE : null;
                        }
                    });
        }

        JsonObject last() {
            return JsonParser.parseString(sent.get(sent.size() - 1)).getAsJsonObject();
        }
    }

    /**
     * Gateway whose {@link ProxyClient}s never dial: the session path is a no-op, so the gate
     * decisions are asserted without a network round-trip. Every created client is tracked so the
     * test tears its executors down.
     */
    static class StubClient extends ProxyClient {
        StubClient(Config config, Gateway gateway) {
            super(config, gateway);
        }

        @Override
        public void onClientMessage(WebSocket conn, String message) {
            // no dial: the deployment gates are the unit under test
        }
    }

    static final class StubGateway extends Gateway {
        final List<StubClient> created = new ArrayList<>();

        StubGateway(Config config) {
            super(config, 0);
        }

        @Override
        ProxyClient newClient() {
            StubClient c = new StubClient(getConfig(), this);
            created.add(c);
            return c;
        }
    }

    private StubGateway gateway;
    private final List<StubGateway> live = new ArrayList<>();

    private StubGateway gateway(String... args) {
        StubGateway g = new StubGateway(Config.parse(args));
        live.add(g);
        gateway = g;
        return g;
    }

    @AfterEach
    void stopClients() {
        for (StubGateway g : live) {
            for (StubClient c : g.created) {
                c.dispose();
            }
        }
        live.clear();
    }

    private static String connect(String user, String token, String browserId) {
        StringBuilder sb = new StringBuilder("{\"requestId\":\"c1\",\"action\":\"connect\",\"args\":{\"host\":\"127.0.0.1\",\"port\":1,\"username\":\"")
                .append(user).append("\"");
        if (token != null) {
            sb.append(",\"authToken\":\"").append(token).append("\"");
        }
        if (browserId != null) {
            sb.append(",\"browserId\":\"").append(browserId).append("\"");
        }
        return sb.append("}}").toString();
    }

    // ── auth token ──

    @Test
    void aMissingTokenIsRejectedTypedAndClosedWith4401() {
        StubGateway g = gateway("--authToken", "secret", "--simRoster", "none");
        FakeConn conn = new FakeConn();
        g.handleConnect(conn.ws(), connect("bob", null, null));

        JsonObject err = conn.last();
        assertEquals("connect_error", err.get("type").getAsString());
        assertEquals(DeploymentConfig.BAD_AUTH_TOKEN_MESSAGE, err.get("message").getAsString());
        assertEquals(4401, conn.closeCode, "the mandatory 4401 close");
        assertEquals(DeploymentConfig.AUTH_REJECTED_CLOSE_REASON, conn.closeReason);
        assertNull(g.findSession("127.0.0.1|bob"), "no session may open behind the token gate");
        assertTrue(g.created.isEmpty(), "the gate must run before any session is created");
    }

    @Test
    void aWrongTokenIsRejectedTypedAndClosedWith4401() {
        StubGateway g = gateway("--authToken", "secret", "--simRoster", "none");
        FakeConn conn = new FakeConn();
        g.handleConnect(conn.ws(), connect("bob", "wrong", null));

        assertEquals("connect_error", conn.last().get("type").getAsString());
        assertEquals(4401, conn.closeCode);
        assertTrue(g.created.isEmpty());
    }

    @Test
    void theCorrectTokenPassesTheGate() {
        StubGateway g = gateway("--authToken", "secret", "--simRoster", "none");
        FakeConn conn = new FakeConn();
        g.handleConnect(conn.ws(), connect("bob", "secret", "web:bob:1"));

        assertTrue(conn.closeCode != 4401, "the correct token must not be rejected");
        assertFalse(conn.sent.stream().anyMatch(s -> s.contains("Bad or missing auth token")));
        assertFalse(g.created.isEmpty(), "the correct token proceeds to the session path");
    }

    @Test
    void anOpenProxyAcceptsAConnectWithoutAToken() {
        StubGateway g = gateway("--simRoster", "none");
        FakeConn conn = new FakeConn();
        g.handleConnect(conn.ws(), connect("bob", null, null));

        assertTrue(conn.closeCode != 4401, "an open proxy is unchanged (localhost dev)");
        assertFalse(conn.sent.stream().anyMatch(s -> s.contains("Bad or missing auth token")));
    }

    // ── anon name guard (integration through handleConnect) ──

    @Test
    void aSecondBrowserWithTheSameAnonNameIsRejectedTypedAndClosedWith4401() {
        StubGateway g = gateway("--simRoster", "none");
        // browser1 already holds "bob" at 127.0.0.1:1 under a different browserId
        AnonNameGuard.shared().checkAndRegister(new Object(), "127.0.0.1", 1, "bob", "web:bob:1");

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, "web:bob:2"));

        JsonObject err = two.last();
        assertEquals("connect_error", err.get("type").getAsString());
        assertEquals(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE, err.get("message").getAsString());
        assertEquals(4401, two.closeCode);
    }

    @Test
    void aSameBrowserIdRetakeIsAllowed() {
        StubGateway g = gateway("--simRoster", "none");
        AnonNameGuard.shared().checkAndRegister(new Object(), "127.0.0.1", 1, "bob", "web:bob:1");

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, "web:bob:1"));

        assertTrue(two.closeCode != 4401, "a same-browserId retake must pass the guard");
        assertFalse(two.sent.stream().anyMatch(s -> s.contains("already in use")));
    }

    @Test
    void twoEmptyBrowserIdsDoNotBlock() {
        StubGateway g = gateway("--simRoster", "none");
        AnonNameGuard.shared().checkAndRegister(new Object(), "127.0.0.1", 1, "bob", "");

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, null));

        assertTrue(two.closeCode != 4401, "two empty browserIds are the old behaviour: do not block");
    }

    @Test
    void theOwnersTeardownReleasesTheGuardRegistration() {
        StubGateway g = gateway("--simRoster", "none");
        FakeConn one = new FakeConn();
        g.handleConnect(one.ws(), connect("bob", null, "web:bob:1"));

        assertEquals(1, AnonNameGuard.shared().registeredCount(), "the connect registered the name");
        // a registration whose dial then fails must still release: dispose() runs on every teardown
        g.created.get(0).dispose();
        assertEquals(0, AnonNameGuard.shared().registeredCount(),
                "the client's teardown released its guard entry");
    }

    @Test
    void theRejectionPathDisposesTheClientItAllocated() {
        StubGateway g = gateway("--simRoster", "none");
        AnonNameGuard.shared().checkAndRegister(new Object(), "127.0.0.1", 1, "bob", "web:bob:1");

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, "web:bob:2"));

        assertEquals(1, g.created.size(), "the refused client was allocated...");
        assertTrue(g.created.get(0).isReleased(), "...and disposed on the rejection path");
    }

    // ── attach path: a DIFFERENT browser must not attach to a held anon name ──

    /** A stub client that looks live + same-session so handleConnect takes the ATTACH branch. */
    static final class ConnectedStubClient extends StubClient {
        ConnectedStubClient(Config config, Gateway gateway) {
            super(config, gateway);
        }

        @Override
        public boolean isConnected() {
            return true;
        }

        @Override
        public boolean isSameSession(String host, int port, String username) {
            return true;
        }
    }

    static final class ConnectedStubGateway extends Gateway {
        final List<ConnectedStubClient> created = new ArrayList<>();

        ConnectedStubGateway(Config config) {
            super(config, 0);
        }

        @Override
        ProxyClient newClient() {
            ConnectedStubClient c = new ConnectedStubClient(getConfig(), this);
            created.add(c);
            return c;
        }
    }

    @Test
    void aDifferentBrowserCannotAttachToAHeldAnonName() {
        // A guessing browser must NOT be attached to the holder's live session (its games, its
        // chat): without the attach-path check the same-name guard is bypassed entirely.
        ConnectedStubGateway g = new ConnectedStubGateway(Config.parse(new String[]{"--simRoster", "none"}));
        FakeConn one = new FakeConn();
        g.handleConnect(one.ws(), connect("bob", null, "web:bob:1"));
        assertEquals(1, g.created.size(), "the holder opened a session");

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, "web:bob:2"));

        assertEquals("connect_error", two.last().get("type").getAsString());
        assertEquals(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE, two.last().get("message").getAsString());
        assertEquals(4401, two.closeCode, "the guessing browser is refused, not attached");
        assertTrue(g.created.size() == 1, "no second session was created for the guesser");
        for (ConnectedStubClient c : g.created) {
            c.dispose();
        }
    }

    @Test
    void aSameBrowserTabStillAttaches() {
        // The legitimate multi-tab case: same browser (browserId is per-BROWSER, localStorage) —
        // the second tab attaches to the one live session, exactly as before the guard.
        ConnectedStubGateway g = new ConnectedStubGateway(Config.parse(new String[]{"--simRoster", "none"}));
        FakeConn one = new FakeConn();
        g.handleConnect(one.ws(), connect("bob", null, "web:bob:1"));

        FakeConn two = new FakeConn();
        g.handleConnect(two.ws(), connect("bob", null, "web:bob:1"));

        assertTrue(two.closeCode != 4401, "a same-browser tab attaches, never 4401");
        assertFalse(two.sent.stream().anyMatch(s -> s.contains(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE)));
        for (ConnectedStubClient c : g.created) {
            c.dispose();
        }
    }

    // ── pinned target (forced through handleConnect) ──

    @Test
    void aPinnedTargetIsForcedOverTheClientsHostPort() {
        StubGateway g = gateway("--pinnedXmageTarget", "10.0.0.5:17181", "--simRoster", "none");
        FakeConn conn = new FakeConn();
        // client asks for 127.0.0.1:1; the pin must win, so the account key is the pinned host
        g.handleConnect(conn.ws(), connect("bob", null, "web:bob:1"));
        assertNull(g.findSession("127.0.0.1|bob"), "the client host must be ignored");
        assertTrue(g.findSession("10.0.0.5|bob") != null, "the pinned host keys the session");
    }

    // ── userIdStr ──

    @Test
    void userIdStrCarriesTheBrowserId() {
        assertEquals("web:bob:1234", ProxyClient.userIdStr("web:bob:1234"));
        assertEquals("web:bob:1234", ProxyClient.userIdStr("  web:bob:1234  "));
    }

    @Test
    void userIdStrFallsBackWhenTheBrowserIdIsAbsent() {
        String fallback = System.getProperty("user.name") + ":" + System.getProperty("os.name") + ":mage-proxy";
        assertEquals(fallback, ProxyClient.userIdStr(null));
        assertEquals(fallback, ProxyClient.userIdStr(""));
        assertEquals(fallback, ProxyClient.userIdStr("   "));
    }
}
