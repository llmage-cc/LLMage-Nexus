package org.mage.proxy;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;

import java.util.UUID;

/**
 * Client-key prompt bridge, return side: the {@code llm_decision} / {@code
 * llm_error} verbs the browser sends back to the proxy for a pending {@code llm_prompt}.
 *
 * <p>Both are gated FIRST on {@code capabilities.llm}: against a server that cannot run client-key
 * LLM seats the reply is the typed {@code CAPABILITY_UNAVAILABLE} BEFORE any RPC. Both then go
 * through the cached reflection seam {@link LlmDecisionSupport} (the fork-only {@code
 * SessionImpl.llmDecision/llmError} plus the {@code LLMPromptPayload.Decision/Failure} payload
 * constructors): when the running class lacks them the reply is the typed
 * {@code CAPABILITY_UNAVAILABLE} too — never a hard compile-time call, never a raw
 * {@code NoSuchMethodError}. A call that returns {@code false} answers {@code ok:false,
 * errorCode:"FAILED"}. Both require a UUID {@code requestId} (else {@code INVALID_ARGUMENT}).
 * Both are high-frequency {@code Activity.QUIET} actions.
 */
final class LlmBridgeCommands {

    private LlmBridgeCommands() {
    }

    static boolean handle(String action, WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        switch (action) {
            case "llm_decision":
                handleDecision(conn, requestId, args, ctx);
                return true;
            case "llm_error":
                handleError(conn, requestId, args, ctx);
                return true;
            default:
                return false;
        }
    }

    private static void handleDecision(WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        if (rejectBeforeRpc(ctx, conn, "llm_decision", requestId)) {
            return;
        }
        UUID rid = JsonArgs.uuid(args, "requestId", null);
        if (rid == null) {
            ctx.gateway().send(conn, ProxyProtocol.resultJson("llm_decision", requestId, false,
                    ProxyProtocol.ERR_INVALID_ARGUMENT, "requestId is required and must be a UUID"));
            return;
        }
        String rawResponse = JsonArgs.str(args, "rawResponse", "");
        if (rawResponse.isEmpty()) {
            ctx.gateway().send(conn, ProxyProtocol.resultJson("llm_decision", requestId, false,
                    ProxyProtocol.ERR_INVALID_ARGUMENT, "rawResponse is required and must not be empty"));
            return;
        }
        String thinking = args.has("thinking") && !args.get("thinking").isJsonNull()
                ? JsonArgs.str(args, "thinking", null) : null;
        int httpStatus = JsonArgs.getInt(args, "httpStatus", 0);
        boolean ok = LlmDecisionSupport.decision(ctx.session(), rid, rawResponse, thinking, httpStatus);
        ctx.gateway().send(conn, ProxyProtocol.resultJson("llm_decision", requestId, ok,
                ok ? null : ProxyProtocol.ERR_FAILED, null));
    }

    private static void handleError(WebSocket conn, String requestId, JsonObject args, CommandContext ctx) {
        if (rejectBeforeRpc(ctx, conn, "llm_error", requestId)) {
            return;
        }
        UUID rid = JsonArgs.uuid(args, "requestId", null);
        if (rid == null) {
            ctx.gateway().send(conn, ProxyProtocol.resultJson("llm_error", requestId, false,
                    ProxyProtocol.ERR_INVALID_ARGUMENT, "requestId is required and must be a UUID"));
            return;
        }
        String message = JsonArgs.str(args, "message", "LLM call failed in browser");
        boolean retryable = JsonArgs.getBool(args, "retryable", false);
        int httpStatus = JsonArgs.getInt(args, "httpStatus", 0);
        boolean ok = LlmDecisionSupport.error(ctx.session(), rid, message, retryable, httpStatus);
        ctx.gateway().send(conn, ProxyProtocol.resultJson("llm_error", requestId, ok,
                ok ? null : ProxyProtocol.ERR_FAILED, null));
    }

    /**
     * The Fail Fast gate, BEFORE any RPC: first the server capability, then the reflection seam.
     * Both answer the typed {@code CAPABILITY_UNAVAILABLE}. True = rejected, do not proceed.
     */
    private static boolean rejectBeforeRpc(CommandContext ctx, WebSocket conn, String action, String requestId) {
        if (CapabilityGate.rejectLlmBridgeWithoutCapability(ctx, conn, action, requestId)) {
            return true;
        }
        if (!LlmDecisionSupport.available()) {
            ctx.gateway().send(conn, ProxyProtocol.resultJson(action, requestId, false,
                    ProxyProtocol.ERR_CAPABILITY_UNAVAILABLE, CapabilityGate.LLM_BRIDGE_UNAVAILABLE_MESSAGE));
            return true;
        }
        return false;
    }
}
