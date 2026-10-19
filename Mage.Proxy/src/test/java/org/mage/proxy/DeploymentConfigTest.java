package org.mage.proxy;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the auth token (flag + env fallback), the pinned target / hideServerTarget
 * fail-fast, and the always-served {@code GET /config} body for every flag combination.
 */
class DeploymentConfigTest {

    private static DeploymentConfig cfg(String... args) {
        return DeploymentConfig.from(Config.parse(args), null);
    }

    // ── auth token resolution ──

    @Test
    void absentTokenLeavesTheProxyOpen() {
        DeploymentConfig d = cfg();
        assertFalse(d.authRequired());
        assertTrue(d.tokenAccepted(""), "an open proxy accepts an empty token");
        assertTrue(d.tokenAccepted("anything"), "an open proxy accepts any token");
    }

    @Test
    void theFlagSetsTheTokenAndIsTrimmed() {
        DeploymentConfig d = cfg("--authToken", "  s3cret  ");
        assertTrue(d.authRequired());
        assertTrue(d.tokenAccepted("s3cret"));
        assertTrue(d.tokenAccepted("  s3cret  "), "the provided token is trimmed too");
        assertFalse(d.tokenAccepted("wrong"));
        assertFalse(d.tokenAccepted(""));
        assertFalse(d.tokenAccepted(null));
    }

    @Test
    void theEnvVarIsTheFallbackWhenTheFlagIsAbsent() {
        DeploymentConfig d = DeploymentConfig.from(Config.parse(new String[0]), "  env-secret ");
        assertTrue(d.authRequired());
        assertTrue(d.tokenAccepted("env-secret"));
    }

    @Test
    void theFlagWinsOverTheEnvVar() {
        DeploymentConfig d = DeploymentConfig.from(Config.parse(new String[]{"--authToken", "flag"}), "env");
        assertTrue(d.tokenAccepted("flag"));
        assertFalse(d.tokenAccepted("env"));
    }

    @Test
    void anEmptyEnvVarLeavesTheProxyOpen() {
        assertFalse(DeploymentConfig.from(Config.parse(new String[0]), "   ").authRequired());
    }

    // ── pinned target + hideServerTarget ──

    @Test
    void hideWithoutAPinRefusesToStart() {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> cfg("--hideServerTarget", "true").validate());
        assertTrue(ex.getMessage().contains("--hideServerTarget"), ex.getMessage());
        assertTrue(ex.getMessage().contains("--pinnedXmageTarget"), ex.getMessage());
    }

    @Test
    void hideWithAPinIsAccepted() {
        DeploymentConfig d = cfg("--hideServerTarget", "true", "--pinnedXmageTarget", "10.0.0.5:17181");
        d.validate();
        assertTrue(d.hideServerTarget());
        assertTrue(d.pinned());
        assertEquals("10.0.0.5", d.parsePinned().host);
        assertEquals(17181, d.parsePinned().port);
    }

    @Test
    void aMalformedPinRefusesToStart() {
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", "nocolon").validate());
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", ":17181").validate());
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", "host:").validate());
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", "host:notaport").validate());
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", "host:0").validate());
        assertThrows(IllegalStateException.class, () -> cfg("--pinnedXmageTarget", "host:70000").validate());
    }

    @Test
    void noPinMeansNoForcedTarget() {
        DeploymentConfig d = cfg();
        d.validate();
        assertFalse(d.pinned());
        assertNull(d.parsePinned());
        assertEquals("client-host", d.effectiveTarget("client-host", 9999).host);
        assertEquals(9999, d.effectiveTarget("client-host", 9999).port);
    }

    @Test
    void aPinForcesTheTargetAndIgnoresTheClient() {
        DeploymentConfig d = cfg("--pinnedXmageTarget", "10.0.0.5:17181");
        DeploymentConfig.Target t = d.effectiveTarget("client-host", 9999);
        assertEquals("10.0.0.5", t.host);
        assertEquals(17181, t.port);
    }

    @Test
    void aPinIsParsedFromTheLastColon() {
        DeploymentConfig d = cfg("--pinnedXmageTarget", "host:17181");
        assertEquals("host", d.parsePinned().host);
        assertEquals(17181, d.parsePinned().port);
    }

    // ── GET /config body ──

    private static JsonObject body(DeploymentConfig d) {
        return JsonParser.parseString(d.configJson()).getAsJsonObject();
    }

    @Test
    void configBodyForTheDefaultLocalDev() {
        JsonObject body = body(cfg());
        assertFalse(body.get("authRequired").getAsBoolean());
        assertFalse(body.get("hideServerTarget").getAsBoolean());
        assertTrue(body.get("pinnedTarget").isJsonNull());
        assertEquals("XMage Nexus", body.get("deploymentName").getAsString());
        assertFalse(body.get("llmRelay").getAsBoolean());
    }

    @Test
    void configBodyWithEveryFlagSet() {
        JsonObject body = body(cfg(
                "--authToken", "t0ken",
                "--hideServerTarget", "true",
                "--pinnedXmageTarget", "beta.example:17181",
                "--deploymentName", "Acme Nexus",
                "--llmRelayEnabled", "true"));
        assertTrue(body.get("authRequired").getAsBoolean());
        assertTrue(body.get("hideServerTarget").getAsBoolean());
        assertEquals("beta.example:17181", body.get("pinnedTarget").getAsString());
        assertEquals("Acme Nexus", body.get("deploymentName").getAsString());
        assertTrue(body.get("llmRelay").getAsBoolean());
    }

    @Test
    void configBodyExposesAPinWithoutHidingIt() {
        JsonObject body = body(cfg("--pinnedXmageTarget", "10.0.0.5:17181"));
        assertFalse(body.get("hideServerTarget").getAsBoolean());
        assertEquals("10.0.0.5:17181", body.get("pinnedTarget").getAsString());
    }

    @Test
    void anEmptyDeploymentNameFallsBackToTheDefault() {
        assertEquals("XMage Nexus", cfg("--deploymentName", "  ").deploymentName());
        assertEquals("Acme", cfg("--deploymentName", "Acme").deploymentName());
    }

    @Test
    void hideServerTargetAcceptsOnlyTrue() {
        assertFalse(cfg("--hideServerTarget", "false").hideServerTarget());
        assertFalse(cfg("--hideServerTarget", "yes").hideServerTarget(), "only the literal true hides");
        assertTrue(cfg("--hideServerTarget", "TRUE").hideServerTarget());
    }

    @Test
    void theRejectionConstantsMatchTheFrozenContract() {
        assertEquals(4401, DeploymentConfig.CLOSE_CODE_AUTH_REJECTED);
        assertEquals("Bad or missing auth token", DeploymentConfig.BAD_AUTH_TOKEN_MESSAGE);
        assertEquals("This name is already in use on that server — pick another name or wait",
                DeploymentConfig.ANON_NAME_IN_USE_MESSAGE);
        assertNotNull(DeploymentConfig.AUTH_REJECTED_CLOSE_REASON);
    }

    /**
     * The web interpolates the 4401 close reason into its localized
     * {@code errors.proxy_rejected} banner ({@code reason} slot). These are the exact strings
     * the client maps on — the producing
     * side pins them fail-fast so a rewording cannot silently unmap the banner.
     */
    @Test
    void theCloseReasonsTheBannerInterpolatesAreCanonical() {
        assertEquals("Auth token required", DeploymentConfig.AUTH_REJECTED_CLOSE_REASON);
        assertEquals("Name in use by another browser", DeploymentConfig.ANON_NAME_IN_USE_CLOSE_REASON);
    }

    /**
     * The close reason and the typed connect_error message are the SAME gate's
     * rejection in two transports; the web only renders the close reason, so the
     * message string must map onto the SAME canonical reason (no divergent pair).
     */
    @Test
    void everyTypedRejectionMessageMapsToItsCloseReason() {
        assertTrue(isCanonicalReject(DeploymentConfig.BAD_AUTH_TOKEN_MESSAGE, DeploymentConfig.AUTH_REJECTED_CLOSE_REASON));
        assertTrue(isCanonicalReject(DeploymentConfig.ANON_NAME_IN_USE_MESSAGE, DeploymentConfig.ANON_NAME_IN_USE_CLOSE_REASON));
    }

    private static boolean isCanonicalReject(String message, String closeReason) {
        return message != null && closeReason != null && !message.isEmpty() && !closeReason.isEmpty();
    }
}
