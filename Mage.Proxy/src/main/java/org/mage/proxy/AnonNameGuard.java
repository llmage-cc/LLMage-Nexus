package org.mage.proxy;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Anon same-name collision guard.
 *
 * <p>The XMage server runs anon mode with {@code ANON_IDENTIFY_BY_HOST=true} (Mage.Server Session.java):
 * a connect with an existing anon name from the SAME host silently kills the older session
 * ({@code DisconnectReason.AnotherUserInstanceSilent}). Every browser dialed through this proxy
 * appears at the server under the proxy's own host, so ANY two webui users who pick the same anon
 * name kick each other; each killed client learns about it one ping-tick later ("Ping failed"),
 * auto-reconnects under the same name, and kills the other back — the kick loop this guard exists
 * to prevent.
 *
 * <p>The proxy is the right place for the guard: it is the only component that sees BOTH the anon
 * username and the per-browser {@code browserId} (the {@code web:<username>:<uuid>} the browser
 * persists in sessionStorage, sent on connect) for every session.
 *
 * <p>Policy: REFUSE the new connect with a "name in use" connect_error + 4401
 * close — the same user-fixable rejection path as a bad auth token. The older session is never
 * touched, so there is nothing to surface to it.
 *
 * <p>Reconnect exception: a same-name connect carrying the SAME browserId is the legitimate
 * takeover path (page refresh with saved creds; restoreSessionId is not forwarded through the
 * proxy, so the server would otherwise treat it as a fresh same-host connect and silently kill the
 * dying session anyway — the guard lets that through unchanged).
 *
 * <p>Scoping: a name collides only per target server ({@code host:port}) — a multi-server proxy must
 * not block "Bob" on server A because "Bob" is connected to server B. Case-insensitive on the
 * username, mirroring UserManagerImpl's
 * {@code users.computeIfAbsent(userName.toLowerCase(Locale.ROOT))}.
 *
 * <p>Ownership: the entry belongs to the owner that registered it (the {@link ProxyClient}), release
 * is identity-checked, and the owner releases on EVERY teardown path (WS close, WS error, deliberate
 * rejection close, failed dial). A dial that fails AFTER registration (auth failure, server offline)
 * is still released. Two empty browserIds (old clients, direct WS probes) never block — the old
 * behaviour — because a holder with no identity cannot claim a name against anyone.
 *
 * <p>This is fork-only: a clean, self-contained class (upstream-contribution candidate). Ported
 * verbatim from {@code mage.webproxy.AnonNameGuard}.
 */
public final class AnonNameGuard {

    private static final Logger logger = Logger.getLogger(AnonNameGuard.class.getName());

    private static final AnonNameGuard SHARED = new AnonNameGuard();

    public static AnonNameGuard shared() {
        return SHARED;
    }

    /** One registration: who holds name {@code username} at {@code host:port}. */
    public static final class ActiveConnect {
        /** The client that claimed the name; release is identity-checked against it. */
        final Object owner;
        final String host;
        final int port;
        /** Lowercased at registration — the map key. */
        final String usernameLower;
        /** As sent on the connect frame; "" when absent (old clients, probes). */
        final String browserId;

        ActiveConnect(Object owner, String host, int port, String usernameLower, String browserId) {
            this.owner = owner;
            this.host = host;
            this.port = port;
            this.usernameLower = usernameLower;
            this.browserId = browserId;
        }
    }

    /** Outcome of a {@link #checkAndRegister} call. */
    public static final class Decision {
        public final boolean allowed;
        /** Non-null when the caller OWNS a new entry cleanup() must release; null when allowed without claiming. */
        public final ActiveConnect active;

        private Decision(boolean allowed, ActiveConnect active) {
            this.allowed = allowed;
            this.active = active;
        }
    }

    /**
     * Key = host + '\0' + port + '\0' + usernameLower. NUL separators so no hostname/username string
     * can forge a boundary (hostnames and the username allowlist [a-zA-Z0-9_] never contain NUL).
     */
    private static String key(String host, int port, String usernameLower) {
        return host + '\0' + port + '\0' + usernameLower;
    }

    private final ConcurrentHashMap<String, ActiveConnect> active = new ConcurrentHashMap<>();

    /**
     * Register {@code username} at {@code host:port} for {@code owner}, or refuse when another live
     * session already holds that name under a DIFFERENT non-empty browserId. Register-and-check are
     * one atomic map operation — two racing connects cannot both pass. A refused connect leaves the
     * map unchanged.
     *
     * <p>Returns {@code active != null} only when the caller now OWNS the entry and must release it
     * on teardown; the allowed-without-claiming cases (a legacy empty-browserId holder) return
     * {@code active == null} so the caller never drops someone else's registration.
     */
    public Decision checkAndRegister(Object owner, String host, int port,
                                     String username, String browserId) {
        String usernameLower = username.toLowerCase(Locale.ROOT);
        ActiveConnect candidate = new ActiveConnect(owner, host, port, usernameLower, browserId);
        String k = key(host, port, usernameLower);
        // Loop instead of a single putIfAbsent: the same-browserId retake needs a
        // compare-and-replace, which putIfAbsent cannot express.
        while (true) {
            ActiveConnect existing = active.putIfAbsent(k, candidate);
            if (existing == null) {
                return new Decision(true, candidate);
            }
            if (owner != null && existing.owner == owner) {
                // Re-registration by the same owner (a second connect attempt on a live session):
                // the original entry stands, so there is nothing new to release.
                // NB: null owners (unit tests driving the guard without a session) must NOT match —
                // null == null would let every ownerless probe take any name over.
                return new Decision(true, existing);
            }
            if (!existing.browserId.isEmpty() && existing.browserId.equals(browserId)) {
                // Legitimate reconnect takeover from the same browser: the old entry's owner is
                // dying (its ping will fail or its socket is already closing — release is
                // identity-checked, so its teardown no-ops against the entry we install now).
                if (active.replace(k, existing, candidate)) {
                    logger.info("Anon name takeover by same browserId for " + usernameLower
                            + " at " + host + ":" + port);
                    return new Decision(true, candidate);
                }
                continue; // raced — re-read and retry
            }
            if (existing.browserId.isEmpty()) {
                // A legacy holder (no browserId) cannot claim a name against anyone — the old
                // no-guard behaviour. Both-empty lands here too: do NOT block.
                return new Decision(true, null);
            }
            return new Decision(false, null);
        }
    }

    /**
     * Read-only sibling of {@link #checkAndRegister} for the ATTACH path: may a connect of
     * {@code username} at {@code host:port} whose browser is {@code browserId} join the already
     * registered session?
     *
     * <p>True when the name is unheld, held by a legacy entry with no browserId, or held by the
     * SAME browserId — that last case is a second tab of one browser, which the proxy is meant to
     * attach to the one live session (its multi-tab model). False when a DIFFERENT non-empty
     * browserId holds the name: attaching would hand that other browser the holder's session,
     * which is exactly the collision this guard exists to stop.
     */
    public boolean matches(String host, int port, String username, String browserId) {
        ActiveConnect existing = active.get(key(host, port, username.toLowerCase(Locale.ROOT)));
        if (existing == null || existing.browserId.isEmpty()) {
            return true;
        }
        return existing.browserId.equals(browserId);
    }

    /**
     * Release {@code c}'s registration. Identity-checked: if the name was re-registered by another
     * owner after {@code c}'s owner died, the newer entry is NOT removed. Idempotent — safe to call
     * from every teardown path.
     */
    public void release(ActiveConnect c) {
        if (c == null) {
            return;
        }
        active.remove(key(c.host, c.port, c.usernameLower), c);
    }

    /** Test hook: how many names are currently registered. */
    int registeredCount() {
        return active.size();
    }

    /** Test hook: drop every registration (between tests). */
    void reset() {
        active.clear();
    }
}
