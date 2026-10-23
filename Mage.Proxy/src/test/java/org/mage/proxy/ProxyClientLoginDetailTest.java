package org.mage.proxy;

import mage.interfaces.MageClient;
import mage.remote.Connection;
import mage.remote.SessionImpl;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The detail of a refused login belongs to the attempt that produced it, even when it is captured
 * <em>before</em> {@code connectStart} returns.
 *
 * <p>A version refusal is delivered by {@code SessionImpl}'s {@code MageVersionException} catch,
 * which calls {@code client.showMessage(...)} from inside {@code connectStart} and never sets
 * {@code lastError}. Sampling the mailbox window after {@code connectStart} returned therefore put
 * the only copy of the reason microseconds outside the window: the wait ran its full 4.5 s, the
 * fallback found an empty last error and the web client was answered a bare {@code FAILED}
 * (measured 10/10 at HEAD; the recorded 2026-10-15 repro hit it on 2 of 9 attempts).
 */
class ProxyClientLoginDetailTest {

    /** Reproduces the ordering of SessionImpl's version-refusal path: message, then return false. */
    static final class VersionRefusingSession extends SessionImpl {
        private final MageClient page;

        VersionRefusingSession(MageClient page) {
            super(null);
            this.page = page;
        }

        @Override
        public boolean connectStart(Connection connection) {
            page.showMessage("Remote task error: mage.remote.MageVersionException: Wrong client version."
                    + "<br/>Your version: 1.4.61-V1<br/>Server version: 1.4.62-V1");
            // the real gap between the capture and connectStart returning is sub-millisecond to a
            // few ms (log flush, monitor exit); 3 ms makes the discarded-window case deterministic
            try {
                Thread.sleep(3);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
            return false;
        }

        @Override
        public String getLastError() {
            return "";
        }
    }

    /** Reproduces the server's username-length refusal: only the message, no last error. */
    static final class UserNameTooLongSession extends SessionImpl {
        private final MageClient page;

        UserNameTooLongSession(MageClient page) {
            super(null);
            this.page = page;
        }

        @Override
        public boolean connectStart(Connection connection) {
            page.showMessage("User name may not be longer than 14 characters");
            return false;
        }

        @Override
        public String getLastError() {
            return "";
        }
    }

    private final ProxyClientStreamTest.RecordingGateway gateway = new ProxyClientStreamTest.RecordingGateway();
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

    private static void set(ProxyClient pc, String field, Object value) throws Exception {
        Field f = ProxyClient.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(pc, value);
    }

    private WebSocket sendConnect(ProxyClient pc, String user) {
        WebSocket page = conn();
        pc.onClientMessage(page, "{\"requestId\":\"c\",\"action\":\"connect\",\"args\":{\"host\":\"127.0.0.1\","
                + "\"port\":1,\"username\":\"" + user + "\",\"password\":\"x\"}}");
        return page;
    }

    private static com.google.gson.JsonObject awaitConnectResult(ProxyClientStreamTest.RecordingGateway gateway, WebSocket page) {
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            for (com.google.gson.JsonObject f : gateway.to(page)) {
                if ("result".equals(f.get("type").getAsString()) && "connect".equals(f.get("action").getAsString())) {
                    return f;
                }
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        throw new AssertionError("the proxy never answered the connect");
    }

    /** RED at HEAD: the answer was {@code FAILED} because the reason predated the sampled window. */
    @Test
    void theRefusalCapturedInsideConnectStartReachesTheConnectResult() throws Exception {
        ProxyClient pc = new ProxyClient(gateway.getConfig(), gateway);
        set(pc, "session", new VersionRefusingSession(pc));
        client = pc;

        com.google.gson.JsonObject result = awaitConnectResult(gateway, sendConnect(pc, "version-refused"));

        assertEquals(false, result.get("ok").getAsBoolean(), "the login was refused");
        assertEquals(ProxyProtocol.ERR_VERSION_MISMATCH, result.get("errorCode").getAsString(),
                "the version refusal must keep its reason, not collapse to a bare FAILED");
        assertTrue(result.get("error").getAsString().contains("Wrong client version"),
                "the detail is the server's refusal text: " + result.get("error").getAsString());
    }

    /**
     * Live 2026-10-21: a 15-character username was refused with the server's exact text but a
     * generic {@code FAILED}. The classifier had no rule for a reason that is only server text.
     */
    @Test
    void theServersOwnRefusalTextIsNotABareFailed() throws Exception {
        ProxyClient pc = new ProxyClient(gateway.getConfig(), gateway);
        set(pc, "session", new UserNameTooLongSession(pc));
        client = pc;

        com.google.gson.JsonObject result = awaitConnectResult(gateway, sendConnect(pc, "wave1021name15"));

        assertEquals(false, result.get("ok").getAsBoolean(), "the login was refused");
        assertEquals(ProxyProtocol.ERR_SERVER_MESSAGE, result.get("errorCode").getAsString(),
                "a server-supplied reason must not collapse to a bare FAILED");
        assertTrue(result.get("error").getAsString().contains("may not be longer than 14 characters"),
                "the detail is the server's refusal text: " + result.get("error").getAsString());
    }

    /** A message from a previous attempt must still be ignored once the window opens earlier. */
    @Test
    void aMessageFromBeforeTheAttemptIsNotReused() {
        ServerMessageMailbox box = new ServerMessageMailbox();
        box.capture("Wrong password", 1);
        assertEquals(ProxyProtocol.ERR_FAILED,
                ProxyClient.loginFailureDetail(box, System.currentTimeMillis(), 20, ""));
    }

    /** With nothing captured and no last error the answer stays the bare FAILED contract. */
    @Test
    void anEmptyMailboxAndLastErrorStayFailed() {
        assertEquals(ProxyProtocol.ERR_FAILED,
                ProxyClient.loginFailureDetail(new ServerMessageMailbox(), System.currentTimeMillis(), 20, ""));
    }
}
