package org.mage.proxy;

import mage.remote.Connection;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code --pinnedXmageTarget} must cover the DIAL, not only
 * the account key. {@link Gateway#handleConnect} applies the pin to its OWN locals (key + attach
 * match) but hands {@link ProxyClient} the RAW JSON frame; before this fix {@code ProxyClient}
 * re-parsed host/port itself and dialed THAT, so a client sending another target bypassed the pin.
 *
 * <p>These tests drive the REAL connect branch with a stub session (no socket opened) and assert
 * the {@link Connection} it hands to {@code SessionImpl.connectStart}: the pin must win, and the
 * unpinned path must still dial exactly what the client sent. Plus a seam assertion on
 * {@link ProxyClient#dialTarget} (the selection), so a regression that drops the call site fails
 * too.
 */
class ProxyClientPinDialTest {

    private static final String CLIENT_HOST = "203.0.113.9";
    private static final int CLIENT_PORT = 19999;

    /** Captures every Connection the connect branch dials; never reaches the network. */
    static final class CapturingSession extends SessionImpl {
        final List<Connection> dials = new ArrayList<>();

        CapturingSession() {
            super(null);
        }

        @Override
        public boolean connectStart(Connection connection) {
            dials.add(connection);
            return false; // the dial TARGET is the unit under test, not a live login
        }

        @Override
        public String getLastError() {
            return "test: dial captured";
        }
    }

    /** Gateway whose send() is a no-op: the WS side is irrelevant here. */
    static final class QuietGateway extends Gateway {
        QuietGateway(String... args) {
            super(Config.parse(args), 0);
        }

        @Override
        public synchronized void send(WebSocket conn, String json) {
        }
    }

    private ProxyClient client;

    @AfterEach
    void stop() {
        if (client != null) {
            client.shutdown();
        }
    }

    private static WebSocket conn() {
        return (WebSocket) Proxy.newProxyInstance(WebSocket.class.getClassLoader(), new Class<?>[]{WebSocket.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("equals")) {
                        return proxy == args[0];
                    }
                    if (method.getName().equals("hashCode")) {
                        return System.identityHashCode(proxy);
                    }
                    return method.getReturnType() == boolean.class ? Boolean.TRUE : null;
                });
    }

    /** A connect frame carrying a target DIFFERENT from any pin. */
    private static String connectFrame() {
        return "{\"requestId\":\"c\",\"action\":\"connect\",\"args\":{"
                + "\"host\":\"" + CLIENT_HOST + "\",\"port\":" + CLIENT_PORT + ","
                + "\"username\":\"bob\",\"password\":\"x\"}}";
    }

    /** Pre-seed the server detail so the failed-login branch does not wait the full 4.5 s. */
    private static void seedServerMessage(ProxyClient pc, String message) throws Exception {
        Field f = ProxyClient.class.getDeclaredField("serverMessages");
        f.setAccessible(true);
        ((ServerMessageMailbox) f.get(pc)).capture(message, Long.MAX_VALUE);
    }

    private static void setField(ProxyClient pc, String field, Object value) throws Exception {
        Field f = ProxyClient.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(pc, value);
    }

    /** Builds a client whose session captures dials, and drives one connect frame through it. */
    private CapturingSession driveConnect(ProxyClient pc) throws Exception {
        CapturingSession session = new CapturingSession();
        setField(pc, "session", session);
        seedServerMessage(pc, "test: dial captured");
        pc.onClientMessage(conn(), connectFrame());
        long deadline = System.currentTimeMillis() + 10_000;
        while (session.dials.isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(5);
        }
        assertTrue(!session.dials.isEmpty(), "the connect branch must dial (stub session captured it)");
        return session;
    }

    // ── dial selection through the REAL connect branch ──

    @Test
    void aPinForcesTheDialTargetEvenWhenTheClientSendsAnotherTarget() throws Exception {
        QuietGateway g = new QuietGateway("--pinnedXmageTarget", "10.0.0.5:17181", "--simRoster", "none");
        client = new ProxyClient(g.getConfig(), g);

        Connection dialed = driveConnect(client).dials.get(0);

        assertEquals("10.0.0.5", dialed.getHost(), "the pin must win over the client's host for the DIAL");
        assertEquals(17181, dialed.getPort(), "the pin must win over the client's port for the DIAL");
        assertNotEquals(CLIENT_HOST, dialed.getHost(), "the client's own target must never be dialed");
    }

    @Test
    void withoutAPinTheDialHonorsTheClientTarget() throws Exception {
        QuietGateway g = new QuietGateway("--simRoster", "none");
        client = new ProxyClient(g.getConfig(), g);

        Connection dialed = driveConnect(client).dials.get(0);

        assertEquals(CLIENT_HOST, dialed.getHost(), "unpinned: the client host stands (localhost dev unchanged)");
        assertEquals(CLIENT_PORT, dialed.getPort(), "unpinned: the client port stands");
    }

    // ── the seam itself (a regression that drops the call site still fails the tests above) ──

    @Test
    void dialTargetReturnsThePinWhenPinned() {
        QuietGateway g = new QuietGateway("--pinnedXmageTarget", "10.0.0.5:17181", "--simRoster", "none");
        client = new ProxyClient(g.getConfig(), g);

        DeploymentConfig.Target t = client.dialTarget(CLIENT_HOST, CLIENT_PORT);
        assertEquals("10.0.0.5", t.host);
        assertEquals(17181, t.port);
    }

    @Test
    void dialTargetReturnsTheClientTargetWhenUnpinned() {
        QuietGateway g = new QuietGateway("--simRoster", "none");
        client = new ProxyClient(g.getConfig(), g);

        DeploymentConfig.Target t = client.dialTarget(CLIENT_HOST, CLIENT_PORT);
        assertEquals(CLIENT_HOST, t.host);
        assertEquals(CLIENT_PORT, t.port);
    }

    /**
     * The client's resolved deployment (not {@code Config} directly) drives the dial: a client built
     * with an explicit pinned DeploymentConfig dials the pin even when its Config is unpinned. Pins
     * the "one deployment, one effective target" contract the gateway relies on.
     */
    @Test
    void theDeploymentGivenToTheClientDrivesTheDial() throws Exception {
        QuietGateway g = new QuietGateway("--simRoster", "none");
        DeploymentConfig pinned = DeploymentConfig.from(
                Config.parse(new String[]{"--pinnedXmageTarget", "10.0.0.7:17182"}));
        client = new ProxyClient(g.getConfig(), g, pinned);

        Connection dialed = driveConnect(client).dials.get(0);
        assertEquals("10.0.0.7", dialed.getHost());
        assertEquals(17182, dialed.getPort());
    }
}
