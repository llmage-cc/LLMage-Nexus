package org.mage.proxy;

import com.google.gson.JsonObject;

/**
 * Deployment gating configuration, resolved once from {@link Config}.
 *
 * <p>Three knobs that only matter on a hosted deployment; the localhost defaults are all no-ops:
 * <ul>
 *   <li>{@code --authToken <t>} (or the {@code MAGEPROXY_AUTH_TOKEN} env var when the flag is absent):
 *       a shared secret every {@code connect} must present. Empty = OPEN (localhost dev unchanged).
 *       The env fallback exists because a {@code -D}/{@code --flag} puts the secret in
 *       {@code /proc/<pid>/cmdline}.</li>
 *   <li>{@code --pinnedXmageTarget host:port} + {@code --hideServerTarget true}: pin the XMage target
 *       so the browser neither chooses nor sees one. Hiding REQUIRES a pin — refuse to start
 *       otherwise (fail fast).</li>
 *   <li>{@code --deploymentName <name>}: the branding string served at {@code GET /config}.</li>
 * </ul>
 *
 * <p>The same object answers the always-served {@code GET /config} body, so the web and the WS gate
 * can never disagree about whether a token is required.
 */
final class DeploymentConfig {

    /** Config key for the shared secret; env {@code MAGEPROXY_AUTH_TOKEN} is the fallback. */
    static final String ENV_AUTH_TOKEN = "MAGEPROXY_AUTH_TOKEN";
    static final String DEFAULT_DEPLOYMENT_NAME = "XMage Nexus";

    /** The user-facing rejection of a connect with a missing/wrong token. */
    static final String BAD_AUTH_TOKEN_MESSAGE = "Bad or missing auth token";
    /** The close reason of a deliberate auth rejection (RFC 6455 private range). */
    static final String AUTH_REJECTED_CLOSE_REASON = "Auth token required";
    /**
     * Application close code for a deliberate rejection the user can fix by resubmitting the form.
     * RFC 6455 reserves 4000-4999 for private/application use; the browser surfaces the code in the
     * CloseEvent, so the client can refuse to auto-reconnect on it.
     */
    static final int CLOSE_CODE_AUTH_REJECTED = 4401;

    /** The user-facing rejection of a same-name anon collision. */
    static final String ANON_NAME_IN_USE_MESSAGE =
            "This name is already in use on that server — pick another name or wait";
    static final String ANON_NAME_IN_USE_CLOSE_REASON = "Name in use by another browser";

    private final String authToken;
    private final String pinnedTarget;
    private final boolean hideServerTarget;
    private final String deploymentName;
    private final boolean llmRelayEnabled;

    private DeploymentConfig(String authToken, String pinnedTarget, boolean hideServerTarget,
                             String deploymentName, boolean llmRelayEnabled) {
        this.authToken = authToken;
        this.pinnedTarget = pinnedTarget;
        this.hideServerTarget = hideServerTarget;
        this.deploymentName = deploymentName;
        this.llmRelayEnabled = llmRelayEnabled;
    }

    /**
     * Resolves the token: a non-empty {@code --authToken} wins; otherwise the
     * {@code MAGEPROXY_AUTH_TOKEN} env var (trimmed) when set; otherwise the proxy is OPEN.
     */
    static DeploymentConfig from(Config config) {
        return from(config, System.getenv(ENV_AUTH_TOKEN));
    }

    /** Test seam: inject the env value without touching the process environment. */
    static DeploymentConfig from(Config config, String envAuthToken) {
        String token = config.get("authToken", "").trim();
        if (token.isEmpty() && envAuthToken != null) {
            token = envAuthToken.trim();
        }
        return new DeploymentConfig(
                token,
                config.get("pinnedXmageTarget", "").trim(),
                "true".equalsIgnoreCase(config.get("hideServerTarget", "false").trim()),
                config.get("deploymentName", DEFAULT_DEPLOYMENT_NAME).trim(),
                config.isLlmRelayEnabled());
    }

    String authToken() {
        return authToken;
    }

    boolean authRequired() {
        return !authToken.isEmpty();
    }

    /** The raw {@code host:port} pin, or "" when unpinned. */
    String pinnedTarget() {
        return pinnedTarget;
    }

    boolean pinned() {
        return !pinnedTarget.isEmpty();
    }

    boolean hideServerTarget() {
        return hideServerTarget;
    }

    String deploymentName() {
        return deploymentName.isEmpty() ? DEFAULT_DEPLOYMENT_NAME : deploymentName;
    }

    boolean llmRelayEnabled() {
        return llmRelayEnabled;
    }

    /**
     * Fail-fast startup validation. Hiding the server target only works when the proxy itself pins
     * the XMage target — without a pin the browser has no way to choose one and every connect would
     * be rejected. Refuse to start rather than boot a broken deployment. A pin that is present but
     * malformed is refused here too, so the operator sees the typo at once instead of at every
     * connect.
     *
     * @throws IllegalStateException with an operator-facing message.
     */
    void validate() {
        if (hideServerTarget && pinnedTarget.isEmpty()) {
            throw new IllegalStateException(
                    "--hideServerTarget requires --pinnedXmageTarget=host:port (without a pinned "
                    + "target the browser cannot choose an XMage server)");
        }
        if (pinned()) {
            Target parsed = parsePinned();
            if (parsed == null) {
                throw new IllegalStateException(
                        "Malformed --pinnedXmageTarget '" + pinnedTarget + "' (expected host:port)");
            }
        }
    }

    /** {@code host:port} a pinned deployment forces on every connect, or null when unpinned/malformed. */
    Target parsePinned() {
        if (pinnedTarget.isEmpty()) {
            return null;
        }
        int colon = pinnedTarget.lastIndexOf(':');
        if (colon <= 0 || colon == pinnedTarget.length() - 1) {
            return null;
        }
        try {
            int port = Integer.parseInt(pinnedTarget.substring(colon + 1).trim());
            if (port <= 0 || port > 65535) {
                return null;
            }
            return new Target(pinnedTarget.substring(0, colon).trim(), port);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** A resolved host/port. */
    static final class Target {
        final String host;
        final int port;

        Target(String host, int port) {
            this.host = host;
            this.port = port;
        }
    }

    /**
     * The effective target of a connect: with a pin, the pin WINS and the
     * client's host/port are ignored entirely; without one, the client's values stand. Shared by the
     * WS gate and the tests so the forced-target contract is pinned in one place.
     */
    Target effectiveTarget(String clientHost, int clientPort) {
        Target pinned = parsePinned();
        return pinned != null ? pinned : new Target(clientHost, clientPort);
    }

    /**
     * True when the connect's provided token matches the configured one. An OPEN proxy (no token)
     * always passes — the localhost default is unchanged. A set token requires an exact match on
     * every connect, attach included.
     */
    boolean tokenAccepted(String provided) {
        if (!authRequired()) {
            return true;
        }
        return authToken.equals(provided == null ? "" : provided.trim());
    }

    /**
     * The always-served {@code GET /config} body. {@code pinnedTarget} is the raw
     * {@code host:port} string or JSON {@code null}.
     */
    String configJson() {
        JsonObject out = new JsonObject();
        out.addProperty("authRequired", authRequired());
        out.addProperty("hideServerTarget", hideServerTarget);
        out.addProperty("pinnedTarget", pinnedTarget.isEmpty() ? null : pinnedTarget);
        out.addProperty("deploymentName", deploymentName());
        out.addProperty("llmRelay", llmRelayEnabled);
        return out.toString();
    }
}
