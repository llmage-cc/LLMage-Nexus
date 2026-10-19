package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.players.PlayerType;
import org.java_websocket.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Capability delivery: every successful connect result (fresh login and attach) carries
 * {@code data.capabilities}; a connect that fails carries none.
 */
class ServerCapabilitiesDeliveryTest {

    /** A session whose login succeeds and whose ServerState reports an LLM-capable server. */
    static final class LlmSession extends mage.remote.SessionImpl {
        LlmSession() {
            super(null);
        }

        @Override
        public boolean connectStart(mage.remote.Connection connection) {
            return true;
        }

        @Override
        public String getSessionId() {
            return "session-id";
        }

        @Override
        public String getLastError() {
            return "";
        }

        @Override
        public PlayerType[] getPlayerTypes() {
            return new PlayerType[]{PlayerType.HUMAN, PlayerType.COMPUTER_LLM};
        }

        @Override
        public String getVersionInfo() {
            return "1.4.62-V1 (build: 2026-10-07T16:35:00Z)";
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

    private JsonObject awaitConnectResultData(WebSocket page) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            JsonObject res = gateway.to(page).stream()
                    .filter(f -> "result".equals(f.get("type").getAsString())
                            && "connect".equals(f.get("action").getAsString()))
                    .map(f -> f.has("data") && f.get("data").isJsonObject() ? f.getAsJsonObject("data") : null)
                    .findFirst().orElse(null);
            if (res != null) {
                return res;
            }
            Thread.sleep(5);
        }
        throw new AssertionError("the proxy never answered the connect");
    }

    @Test
    void aSuccessfulLoginShipsTheProbedCapabilities() throws Exception {
        client = new ProxyClient(gateway.getConfig(), gateway);
        set(client, "session", new LlmSession());
        WebSocket page = conn();
        client.onClientMessage(page, "{\"requestId\":\"c1\",\"action\":\"connect\",\"args\":{\"host\":\"127.0.0.1\","
                + "\"port\":1,\"username\":\"caps-user\",\"password\":\"x\"}}");
        JsonObject data = awaitConnectResultData(page);
        assertEquals(false, data.get("attached").getAsBoolean());
        JsonObject caps = data.getAsJsonObject("capabilities");
        assertEquals(true, caps.get("llm").getAsBoolean());
        assertEquals("1.4.62-V1", caps.get("serverVersion").getAsString());
        assertEquals(2, caps.getAsJsonArray("playerTypes").size());
        assertTrue(client.capabilities().supportsLlm());
    }

    @Test
    void anAttachShipsTheSameCapabilities() throws Exception {
        client = new ProxyClient(gateway.getConfig(), gateway);
        set(client, "session", new LlmSession());
        set(client, "connected", true);
        set(client, "capabilities", ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1",
                Arrays.asList("HUMAN", "COMPUTER_LLM")));
        WebSocket page = conn();
        client.attach(page, "c2", null, -1);
        JsonObject data = awaitConnectResultData(page);
        assertEquals(true, data.get("attached").getAsBoolean());
        assertEquals(true, data.getAsJsonObject("capabilities").get("llm").getAsBoolean());
    }

    @Test
    void aFailedLoginCarriesNoCapabilities() throws Exception {
        client = new ProxyClient(gateway.getConfig(), gateway);
        set(client, "session", new ProxyClientFailedLoginTest.FailingSession());
        // seed the server's delayed detail so the failure branch answers at once
        Field f = ProxyClient.class.getDeclaredField("serverMessages");
        f.setAccessible(true);
        ((ServerMessageMailbox) f.get(client)).capture("wrong password", Long.MAX_VALUE);
        WebSocket page = conn();
        client.onClientMessage(page, "{\"requestId\":\"c3\",\"action\":\"connect\",\"args\":{\"host\":\"127.0.0.1\","
                + "\"port\":1,\"username\":\"caps-fail\",\"password\":\"x\"}}");
        long deadline = System.currentTimeMillis() + 10000;
        JsonObject res = null;
        while (System.currentTimeMillis() < deadline && res == null) {
            res = gateway.to(page).stream()
                    .filter(fr -> "result".equals(fr.get("type").getAsString())
                            && "connect".equals(fr.get("action").getAsString()))
                    .findFirst().orElse(null);
            Thread.sleep(5);
        }
        assertTrue(res != null, "no connect result at all");
        assertFalse(res.get("ok").getAsBoolean());
        assertFalse(res.has("data") && res.get("data").isJsonObject()
                && res.getAsJsonObject("data").has("capabilities"));
    }

    @Test
    void aNewLoginResetsTheCapabilitiesUntilTheServerProvesThemAgain() throws Exception {
        client = new ProxyClient(gateway.getConfig(), gateway);
        set(client, "capabilities", ServerCapabilities.forTest(true, false, true, true, "1.4.62-V1",
                Arrays.asList("HUMAN", "COMPUTER_LLM")));
        java.lang.reflect.Method reset = ProxyClient.class.getDeclaredMethod("resetSessionState");
        reset.setAccessible(true);
        reset.invoke(client);
        assertFalse(client.capabilities().supportsLlm(),
                "the previous login's capabilities must not gate the new session");
    }
}
