package org.mage.proxy;

import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft;
import org.java_websocket.drafts.Draft_6455;
import org.java_websocket.extensions.permessage_deflate.PerMessageDeflateExtension;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * WebSocket server: transport between the web client and the proxy logic.
 * <p>
 * Local-first security, all enforced at the transport:
 * - bind to 127.0.0.1 by default (configurable with --bind)
 * - reject WebSocket origins that are not localhost (or --allowedOrigins)
 * - per-connection message size and rate limits
 */
public class Gateway extends WebSocketServer {

    private static final Logger logger = Logger.getLogger(Gateway.class.getName());
    private final Config config;
    /** conn -> its ProxyClient (a dedicated session, or one shared per account). */
    private final Map<WebSocket, ProxyClient> byConn = Collections.synchronizedMap(new IdentityHashMap<WebSocket, ProxyClient>());
    /** host|username -> connected ProxyClient (to re-attach windows of the same account). */
    private final Map<String, ProxyClient> byAccount = new ConcurrentHashMap<>();

    /** per-connection message count (1 s sliding window) */
    private final Map<WebSocket, String> connIp = Collections.synchronizedMap(new IdentityHashMap<WebSocket, String>());

    /** WebSocket transport errors, only to throttle the log: one stack, then one line per minute. */
    private volatile int wsErrors = 0;

    public String ipOf(WebSocket conn) {
        String ip = connIp.get(conn);
        return ip == null ? "" : ip;
    }

    private static String clientIp(WebSocket conn, ClientHandshake handshake) {
        String fwd = handshake.hasFieldValue("X-Forwarded-For") ? handshake.getFieldValue("X-Forwarded-For") : "";
        if (!fwd.isEmpty()) {
            return fwd.split(",")[0].trim();
        }
        InetSocketAddress a = conn.getRemoteSocketAddress();
        return a == null || a.getAddress() == null ? "" : a.getAddress().getHostAddress();
    }

    /** Connections whose page announced it is closing ({@code leaving}). */
    private final Set<WebSocket> leaving = Collections.newSetFromMap(Collections.synchronizedMap(new IdentityHashMap<WebSocket, Boolean>()));

    private final Map<WebSocket, Deque<Long>> messageTimes =
            Collections.synchronizedMap(new IdentityHashMap<WebSocket, Deque<Long>>());

    public Gateway(Config config) {
        this(config, config.getWsPort());
    }

    /** Deployment gating knobs (auth token, pin, hide, branding), resolved once at startup. */
    private final DeploymentConfig deployment;

    public Gateway(Config config, int port) {
        super(new InetSocketAddress(config.getBindAddress(), port), drafts());
        this.config = config;
        this.deployment = DeploymentConfig.from(config);
        this.simRoster = SimRoster.fromConfig(config);
        setReuseAddr(true);
    }

    /** The deployment gating config (auth token, pinned target, branding) resolved at startup. */
    public DeploymentConfig deployment() {
        return deployment;
    }

    private final SimRoster simRoster;
    private final java.util.concurrent.ScheduledExecutorService rosterTimer =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "sim-roster");
                t.setDaemon(true);
                return t;
            });

    /** SIM seats kept across proxy restarts (shared by every session of this proxy). */
    public SimRoster simRoster() {
        return simRoster;
    }

    /**
     * permessage-deflate: a GameView frame is ~200 KB of repetitive JSON (800 KB with many
     * tokens) and shrinks ~10-50x, which is most of the latency of a remote player. Clients
     * that do not offer the extension still connect uncompressed.
     */
    static List<Draft> drafts() {
        return Collections.<Draft>singletonList(new Draft_6455(new PerMessageDeflateExtension()));
    }

    public Config getConfig() {
        return config;
    }

    public void registerSession(String key, ProxyClient pc) {
        byAccount.put(key, pc);
    }

    public void unregisterSession(String key, ProxyClient pc) {
        byAccount.remove(key, pc);
    }

    public ProxyClient findSession(String key) {
        return byAccount.get(key);
    }

    public java.util.Collection<ProxyClient> getSessions() {
        return byAccount.values();
    }

    /**
     * Clients built since start, and how many of them have already been released. The difference
     * is the leak detector: a client that is neither alive nor disposed owns six non-daemon
     * threads and nothing ever reaches it again. Counted from the {@link ProxyClient} constructor
     * and from {@link ProxyClient#dispose()}, not from {@link #newClient()}, so a test double (or a
     * future factory) cannot make the counters drift from the resources they describe.
     */
    private final java.util.concurrent.atomic.AtomicLong clientsCreated =
            new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong clientsDisposed =
            new java.util.concurrent.atomic.AtomicLong();
    private volatile int peakThreads = 0;

    void clientCreated() {
        clientsCreated.incrementAndGet();
    }

    void clientDisposed() {
        clientsDisposed.incrementAndGet();
    }

    /**
     * One line per minute on the existing roster tick.
     *
     * <p>{@code clientsAlive} is the number to read across ticks: a session that is playing
     * accounts for one, a client released after a failed login for none, so anything that climbs
     * while the connection count does not is a client nothing ever reached. The warning fires on
     * that shape rather than on any single transient, because a client stays registered on its
     * (still open) socket for a moment after a rejected login - flagging that would be noise.
     */
    private void watchdogTick() {
        int threads = java.lang.management.ManagementFactory.getThreadMXBean().getThreadCount();
        if (threads > peakThreads) {
            peakThreads = threads;
        }
        long created = clientsCreated.get();
        long disposed = clientsDisposed.get();
        long alive = created - disposed;
        int open;
        synchronized (byConn) {
            open = byConn.size();
        }
        int accounts = byAccount.size();
        logger.info("watchdog: threads=" + threads + " (peak " + peakThreads + "), openConns=" + open
                + ", accounts=" + accounts + ", clientsAlive=" + alive + " (created=" + created
                + " disposed=" + disposed + "), wsErrors=" + wsErrors + ", cardDb=" + DeckValidation.getState());
        int reachable = accounts + open;
        if (alive > reachable + 5) {
            logger.warning("watchdog: " + alive + " clients alive but only " + reachable
                    + " reachable through an account key or a connection; the difference holds six "
                    + "non-daemon threads each and will not be released until the proxy restarts");
        }
    }

    /**
     * Runtime counters for the admin endpoint: everything here was already derivable from state
     * the process keeps, and each missing one has cost a debugging session (a thread count that
     * showed a leak nobody could see, a card database that silently failed).
     */
    com.google.gson.JsonObject runtime() {
        com.google.gson.JsonObject out = new com.google.gson.JsonObject();
        java.lang.management.MemoryMXBean heap = java.lang.management.ManagementFactory.getMemoryMXBean();
        out.addProperty("threads", java.lang.management.ManagementFactory.getThreadMXBean().getThreadCount());
        out.addProperty("peakThreads", peakThreads);
        out.addProperty("heapUsedBytes", heap.getHeapMemoryUsage().getUsed());
        out.addProperty("heapMaxBytes", heap.getHeapMemoryUsage().getMax());
        out.addProperty("gcCount", java.lang.management.ManagementFactory.getGarbageCollectorMXBeans().stream()
                .mapToLong(java.lang.management.GarbageCollectorMXBean::getCollectionCount).sum());
        out.addProperty("clientsCreated", clientsCreated.get());
        out.addProperty("clientsDisposed", clientsDisposed.get());
        out.addProperty("clientsAlive", clientsCreated.get() - clientsDisposed.get());
        out.addProperty("accountsRegistered", byAccount.size());
        out.addProperty("wsErrors", wsErrors);
        out.addProperty("cardDb", DeckValidation.getState().name());
        out.addProperty("deckImportsInFlight", OnlineDeckCommands.inFlight());
        return out;
    }

    /** Per-session state, for the sessions that are stuck rather than the ones that are missing. */
    com.google.gson.JsonArray sessionsDetail() {
        com.google.gson.JsonArray out = new com.google.gson.JsonArray();
        for (ProxyClient pc : byConn.values()) {
            out.add(pc.diagnostics());
        }
        return out;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        String origin = handshake.getFieldValue("Origin");
        String ip = clientIp(conn, handshake);
        if (!originAllowed(origin)) {
            Activity.wsRejected(ip, origin);
            System.err.println("[proxy] ws rejected origin=" + origin);
            conn.close(1008, "origin not allowed");
            return;
        }
        connIp.put(conn, ip);
        conn.setAttachment(new Object());
        Activity.wsOpen(ip, origin);
        // Lazy: the session is created in handleConnect (on `connect`), so the connection can be
        // re-attached to an existing session of the same account.
        sendReady(conn);
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        messageTimes.remove(conn);
        boolean left = leaving.remove(conn);
        ProxyClient pc = byConn.remove(conn);
        if (pc != null) {
            pc.onClientClose(conn, left);
            // a client that never held a session (failed login, or a link that could not be
            // restored) has nothing left to serve and no grace timer to run, so its threads
            // would otherwise outlive the WebSocket for the life of the process
            if (pc.isDisposable()) {
                pc.dispose();
            }
        }
        String ip = connIp.remove(conn);
        if (ip != null) {
            Activity.wsClose(ip, pc == null ? null : pc.getActivityUser(), code);
        }
        System.err.println("[proxy] ws close: " + conn.getRemoteSocketAddress() + " code=" + code + " reason='" + reason + "'");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        if (!rateLimit(conn)) {
            conn.close(1008, "message rate limit exceeded");
            return;
        }
        if (message.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > config.getMaxMessageBytes()) {
            conn.close(1009, "message too large");
            return;
        }
        if (isLeaving(message)) {
            // the page is closing: no answer, its socket closes right after
            leaving.add(conn);
            return;
        }
        String pingRequestId = pingRequestId(message);
        if (pingRequestId != null) {
            // answered here, never queued behind a slow command of the session
            // (the web heartbeat would take a busy queue for a dead socket)
            send(conn, ProxyProtocol.resultJson("ping", pingRequestId, true, null, "pong"));
            return;
        }
        ProxyClient pc = byConn.get(conn);
        if (pc != null && !pc.isReleased()) {
            pc.onClientMessage(conn, message);
            return;
        }
        if (pc != null) {
            byConn.remove(conn, pc);
        }
        // Pre-auth: solo se acepta `connect` (y `ping`, keep-alive público).
        String action = "";
        String requestId = "";
        try {
            JsonObject cmd = JsonParser.parseString(message).getAsJsonObject();
            action = cmd.has("action") ? cmd.get("action").getAsString() : "";
            if (cmd.has("requestId") && cmd.get("requestId").isJsonPrimitive()) {
                requestId = cmd.get("requestId").getAsString();
            }
        } catch (Exception ex) {
            send(conn, ProxyProtocol.resultJson("", "", false, ProxyProtocol.ERR_BAD_JSON, "Bad JSON"));
            return;
        }
        if ("connect".equals(action)) {
            handleConnect(conn, message);
        } else {
            send(conn, ProxyProtocol.resultJson(action, requestId, false, ProxyProtocol.ERR_NOT_AUTHORIZED, "send connect first"));
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        // A bind failure is not a degraded proxy, it is a corpse: the process would keep answering
        // HTTP (and report /ready) while another process owns the WebSocket port, which reads as
        // every script failing in a different way. Refuse to look alive.
        if (ex instanceof java.net.BindException) {
            logger.log(Level.SEVERE, "cannot bind the WebSocket port " + config.getWsPort()
                    + " (another proxy still holds it?); exiting instead of running half-alive", ex);
            System.exit(1);
        }
        // A client that desyncs or drops can raise this on every frame, and System.err has no
        // rotation: the raw exception text alone also hides the cause. First one with its stack,
        // then one line per minute, the same shape as the lobby publish throttle.
        String where = conn == null ? "no connection" : String.valueOf(conn.getRemoteSocketAddress());
        wsErrors++;
        if (wsErrors == 1) {
            logger.log(Level.SEVERE, "WebSocket error on " + where, ex);
        } else if (wsErrors % 30 == 0) {
            logger.log(Level.WARNING, "WebSocket errors still coming (" + wsErrors + " so far, last on "
                    + where + "): " + ex);
        }
    }

    @Override
    public void onStart() {
        rosterTimer.scheduleWithFixedDelay(simRoster::touch, 60, 60, java.util.concurrent.TimeUnit.SECONDS);
        rosterTimer.scheduleWithFixedDelay(this::watchdogTick, 60, 60, java.util.concurrent.TimeUnit.SECONDS);
    }

    /**
     * The only way a frame leaves the proxy. Sends to one connection are serialized: with
     * permessage-deflate the connection's Deflater is not thread-safe, and the command, callback,
     * lobby and WebSocket threads all write to the same connection. The lock is a private object
     * (the connection's attachment), never the connection itself: Java-WebSocket holds that
     * monitor while it runs onClose, and a sender waiting on it under a session lock deadlocks
     * the whole WebSocket server.
     */
    public void send(WebSocket conn, String json) {
        if (conn == null) {
            return;
        }
        Object lock = conn.getAttachment();
        synchronized (lock != null ? lock : fallbackSendLock) {
            if (conn.isOpen()) {
                conn.send(json);
            }
        }
    }

    private final Object fallbackSendLock = new Object();

    /** Intercepts `connect` to decide create-vs-attach before creating the session. */
    void handleConnect(WebSocket conn, String message) {
        String requestId = "";
        String host;
        int port;
        String username;
        String browserId;
        String authToken;
        String resumeStream;
        long resumeSeq;
        try {
            JsonObject cmd = JsonParser.parseString(message).getAsJsonObject();
            if (cmd.has("requestId") && cmd.get("requestId").isJsonPrimitive()) {
                requestId = cmd.get("requestId").getAsString();
            }
            JsonObject args = cmd.has("args") && cmd.get("args").isJsonObject()
                    ? cmd.getAsJsonObject("args") : new JsonObject();
            host = args.has("host") ? args.get("host").getAsString() : config.getServerHost();
            port = args.has("port") ? args.get("port").getAsInt() : config.getServerPort();
            username = args.has("username") ? args.get("username").getAsString() : config.getUsername();
            browserId = args.has("browserId") && !args.get("browserId").isJsonNull()
                    ? args.get("browserId").getAsString() : "";
            authToken = args.has("authToken") && !args.get("authToken").isJsonNull()
                    ? args.get("authToken").getAsString() : "";
            resumeStream = ProxyClient.resumeStream(args);
            resumeSeq = ProxyClient.resumeSeq(args);
        } catch (Exception ex) {
            send(conn, ProxyProtocol.resultJson("connect", requestId, false, ProxyProtocol.ERR_BAD_JSON, "Bad JSON: " + ex.getMessage()));
            return;
        }

        // Deployment gating, BEFORE any session create/attach. The auth token is
        // presented on EVERY connect including a reload's auto-attach, so the gate runs first and
        // an attach does not bypass it. A missing/wrong token answers the typed connect_error AND
        // closes 4401: the browser will not retry while the socket is open, so the close is
        // mandatory. An OPEN proxy (no token configured) is a no-op — localhost dev unchanged.
        if (!deployment.tokenAccepted(authToken)) {
            logger.warning("connect rejected: bad or missing auth token");
            send(conn, ProxyProtocol.connectErrorJson(DeploymentConfig.BAD_AUTH_TOKEN_MESSAGE));
            closeForRejection(conn, DeploymentConfig.AUTH_REJECTED_CLOSE_REASON);
            return;
        }

        // Pinned target: the proxy FORCES it on every connect, ignoring the
        // client's host/port. Applied here so the account key, the attach match and the dial all
        // agree on the same effective target.
        DeploymentConfig.Target effective = deployment.effectiveTarget(host, port);
        host = effective.host;
        port = effective.port;

        DeckValidation.State dbState = DeckValidation.getState();
        if (dbState == DeckValidation.State.NOT_STARTED || dbState == DeckValidation.State.BUILDING) {
            send(conn, ProxyProtocol.resultJson("connect", requestId, false, ProxyProtocol.ERR_WARMING_UP,
                    "Proxy is still loading card data, retry in a few seconds"));
            return;
        }
        String key = ProxyClient.normalizeHost(host) + "|" + username;
        host = ProxyClient.normalizeHost(host);
        ProxyClient existing = byAccount.get(key);
        if (existing != null && (existing.isConnected() || existing.isRelinking()) && existing.isSameSession(host, port, username)) {
            // Cross-browser same-name refusal on the ATTACH path. Without this the
            // same-name collision guard is bypassed entirely: any other browser that guesses a name
            // gets attached to the holder's live session (its games, its chat) instead of being
            // refused. The guard's own same-browserId takeover exception is the legitimate reconnect
            // (a second tab / a reload) and still passes — browserId is per-BROWSER.
            if (!AnonNameGuard.shared().matches(host, port, username, browserId)) {
                logger.warning("connect rejected: anon name '" + username + "' is held at "
                        + host + ":" + port + " by a different browser");
                send(conn, ProxyProtocol.connectErrorJson(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE));
                closeForRejection(conn, DeploymentConfig.ANON_NAME_IN_USE_CLOSE_REASON);
                return;
            }
            // a session that is logging in again after losing the server keeps its clients:
            // they get the relink progress and the restored games on the same stream
            logger.info("connect: attach conn to existing session key=" + key);
            byConn.put(conn, existing);
            existing.attach(conn, requestId, resumeStream, resumeSeq);
            Activity.login(username, ipOf(conn), host, port, true, null, true);
            return;
        }
        if (existing != null && !existing.isConnected() && !existing.isReleased()) {
            // its XMage session was closed keeping the tables (grace period, lost server link):
            // logging in again through the same client restores the games with their bots
            logger.info("connect: re-login through the idle client of key=" + key);
            byConn.put(conn, existing);
            existing.onClientMessage(conn, message);
            return;
        }
        logger.info("connect: NEW ProxyClient key=" + key + " (existing="
                + (existing == null ? "null" : ("connected=" + existing.isConnected()
                        + " sameSession=" + existing.isSameSession(host, port, username))) + ")");
        ProxyClient pc = newClient();
        // Anon same-name collision guard: register-and-check is ATOMIC per
        // host:port, BEFORE the dial. A connect whose anon name is already held at that target by a
        // DIFFERENT browserId is refused with the typed connect_error + 4401; the older session is
        // never touched. A same-browserId retake is the legitimate reconnect takeover (allowed,
        // replacing the entry). Both browserIds empty = the old behaviour (do not block).
        AnonNameGuard.Decision guard = AnonNameGuard.shared()
                .checkAndRegister(pc, host, port, username, browserId);
        if (!guard.allowed) {
            logger.warning("connect rejected: anon name '" + username + "' already held at "
                    + host + ":" + port + " by a different browserId");
            send(conn, ProxyProtocol.connectErrorJson(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE));
            closeForRejection(conn, DeploymentConfig.ANON_NAME_IN_USE_CLOSE_REASON);
            pc.dispose();
            return;
        }
        // The entry (if new) is released on EVERY teardown path via ProxyClient.dispose().
        pc.setActiveConnect(guard.active);
        byConn.put(conn, pc);
        // registered before its login ends: a second connect of this account meanwhile (a
        // retry, another tab) queues behind this login and attaches to it instead of opening a
        // second server session that would kick this one out (and be kicked back by its relink)
        if (existing == null) {
            byAccount.putIfAbsent(key, pc);
        } else {
            byAccount.replace(key, existing, pc);
        }
        pc.onClientMessage(conn, message);
    }

    /**
     * Closes a connection after a connect rejection the user can fix by resubmitting the form. The
     * browser's WS manager treats an OPEN socket as "already connected" and silently drops a
     * retried connect, so the close is mandatory; 4401 tells the client not to auto-reconnect (an
     * auto-reconnect would resend the SAME rejected frame and loop). The typed error is delivered
     * before this close.
     */
    void closeForRejection(WebSocket conn, String reason) {
        try {
            if (conn != null && conn.isOpen()) {
                conn.close(DeploymentConfig.CLOSE_CODE_AUTH_REJECTED, reason);
            }
        } catch (Throwable t) {
            logger.warning("Failed to close socket after connect rejection: " + t.getMessage());
        }
    }

    /** A {@code leaving} notice: the page is being closed or navigated away. */
    static boolean isLeaving(String message) {
        if (!message.contains("\"leaving\"")) {
            return false;
        }
        try {
            JsonObject cmd = JsonParser.parseString(message).getAsJsonObject();
            return cmd.has("action") && "leaving".equals(cmd.get("action").getAsString());
        } catch (Exception ex) {
            return false;
        }
    }

    ProxyClient newClient() {
        return new ProxyClient(config, this, deployment);
    }

    /** requestId of a `ping` command ("" when it has none), or null for any other message. */
    static String pingRequestId(String message) {
        if (!message.contains("\"ping\"")) {
            return null;
        }
        try {
            JsonObject cmd = JsonParser.parseString(message).getAsJsonObject();
            if (!cmd.has("action") || !"ping".equals(cmd.get("action").getAsString())) {
                return null;
            }
            return cmd.has("requestId") && cmd.get("requestId").isJsonPrimitive() ? cmd.get("requestId").getAsString() : "";
        } catch (Exception ex) {
            return null;
        }
    }

    private void sendReady(WebSocket conn) {
        JsonObject ev = new JsonObject();
        ev.addProperty("type", "info");
        ev.addProperty("message", "Proxy ready. Send {\"action\":\"connect\",...} to log in.");
        send(conn, ev.toString());
    }

    /**
     * Allows connections without an Origin (node/self-test) and localhost origins.
     * When --allowedOrigins is set, only those exact values are accepted.
     * <p>
     * The desktop launcher (Tauri) counts as "localhost" even when its Origin is
     * not literally localhost: on macOS/Linux it uses the custom scheme
     * {@code tauri://localhost} (host already "localhost"), but on Windows
     * WebView2 does not support custom schemes and Tauri serves the app through a
     * "virtual host" {@code http://tauri.localhost} — same local process, different
     * host — so it is accepted explicitly in addition to "localhost" itself.
     */
    boolean originAllowed(String origin) {
        if (origin == null || origin.isEmpty()) {
            return true;
        }
        Set<String> allowed = config.getAllowedOrigins();
        if (!allowed.isEmpty()) {
            return allowed.contains(origin);
        }
        try {
            String host = new URI(origin).getHost();
            if (host == null) {
                return false;
            }
            String h = host.toLowerCase(Locale.ROOT);
            return h.equals("localhost") || h.equals("127.0.0.1") || h.equals("::1")
                    || h.equals("tauri.localhost") || h.equals("ipc.localhost");
        } catch (Exception ex) {
            return false;
        }
    }

    private boolean rateLimit(WebSocket conn) {
        int max = config.getMaxMessagesPerSecond();
        if (max <= 0) {
            return true;
        }
        long now = System.currentTimeMillis();
        Deque<Long> times;
        synchronized (messageTimes) {
            times = messageTimes.get(conn);
            if (times == null) {
                times = new ArrayDeque<>();
                messageTimes.put(conn, times);
            }
        }
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() > 1000) {
                times.pollFirst();
            }
            if (times.size() >= max) {
                return false;
            }
            times.addLast(now);
            return true;
        }
    }
}
