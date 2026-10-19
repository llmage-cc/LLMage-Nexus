package org.mage.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import mage.players.LLMPlayerConfig;
import mage.players.PlayerType;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * The optional {@code llmConfigs} argument of {@code createTable} / {@code createTournamentTable}:
 * an array with ONE ENTRY PER COMPUTER_LLM SEAT, in {@code playerTypes} order. The k-th
 * COMPUTER_LLM seat consumes the k-th entry; a {@code null} entry (or a missing one) means
 * "server defaults for that seat". The parsed list is stored on
 * {@code MatchOptions.llmPlayerConfigs}, which the server consumes positionally
 * ({@code TableController.wireLlmConfigs}).
 *
 * <p>Fields are parsed one by one into {@link LLMPlayerConfig} instead of deserializing the
 * JSON wholesale with gson: that class carries a static ThreadLocal (pending seat-config
 * delivery) and a pinned serialVersionUID, and its POJO field names are the protocol names
 * by construction (absent/null leaves the null "use server default" value).
 *
 * <p>Validations ported from the engine's {@code WebProxySession.parseLLMConfig}:
 * apiEndpoint must be http/https, cloud metadata hosts are blocked, the host must pass the
 * {@code --allowedModelHosts} allowlist, {@code apiKey} + {@code useClientKey:true} are
 * mutually exclusive, and {@code useClientKey:true} requires a non-empty {@code clientKeyTag}.
 * Every violation throws {@link IllegalArgumentException} with the clear reason; the command
 * handlers answer {@code ok:false, errorCode:"INVALID_ARGUMENT"}.
 */
final class LlmConfigs {

    private LlmConfigs() {
    }

    /**
     * Parses {@code llmConfigs} aligned to the COMPUTER_LLM seats of {@code playerTypes}.
     * Returns an empty list when the argument is absent or there is no LLM seat; otherwise
     * exactly one entry per LLM seat (possibly {@code null} = server defaults for that seat).
     */
    static List<LLMPlayerConfig> parse(JsonObject args, List<PlayerType> playerTypes, Set<String> allowedModelHosts) {
        List<LLMPlayerConfig> out = new ArrayList<>();
        if (!args.has("llmConfigs") || args.get("llmConfigs").isJsonNull()) {
            return out;
        }
        JsonElement raw = args.get("llmConfigs");
        if (!raw.isJsonArray()) {
            throw new IllegalArgumentException(
                    "llmConfigs must be an array with one entry per COMPUTER_LLM seat (or omitted)");
        }
        JsonArray arr = raw.getAsJsonArray();
        if (arr.size() == 0) {
            return out;
        }
        int k = 0;
        for (PlayerType pt : playerTypes) {
            if (pt != PlayerType.COMPUTER_LLM) {
                continue;
            }
            int idx = k++;
            if (idx >= arr.size()) {
                out.add(null); // absent entry: server defaults for this seat
                continue;
            }
            JsonElement e = arr.get(idx);
            if (e == null || e.isJsonNull()) {
                out.add(null); // explicit null: server defaults for this seat
                continue;
            }
            if (!e.isJsonObject()) {
                throw new IllegalArgumentException("llmConfigs[" + idx
                        + "] must be an object or null (one entry per COMPUTER_LLM seat)");
            }
            out.add(parseEntry(e.getAsJsonObject(), idx, allowedModelHosts));
        }
        return out;
    }

    /** Per-field parse of one seat config (JSON name = LLMPlayerConfig field name). */
    static LLMPlayerConfig parseEntry(JsonObject c, int idx, Set<String> allowedModelHosts) {
        LLMPlayerConfig out = new LLMPlayerConfig();
        // ── Core ──
        String model = string(c, "model", idx);
        if (model != null) {
            out.setModel(model);
        }
        String endpoint = string(c, "apiEndpoint", idx);
        if (endpoint != null) {
            out.setApiEndpoint(validatedEndpoint(endpoint, idx, allowedModelHosts));
        }
        String apiKey = string(c, "apiKey", idx);
        if (apiKey != null) {
            out.setApiKey(apiKey);
        }
        Boolean useClientKey = bool(c, "useClientKey", idx);
        if (useClientKey != null) {
            // Client-key bridge: the browser keeps the key and the seat runs in browser-key
            // mode. A seat cannot carry both — ambiguous which key the provider call would use.
            if (useClientKey && out.getApiKey() != null && !out.getApiKey().isEmpty()) {
                throw new IllegalArgumentException("llmConfigs[" + idx + "]: seat cannot set both apiKey and "
                        + "useClientKey — useClientKey means the key stays in the browser");
            }
            out.setUseClientKey(useClientKey);
            if (useClientKey) {
                String tag = string(c, "clientKeyTag", idx);
                if (tag == null || tag.isEmpty()) {
                    throw new IllegalArgumentException("llmConfigs[" + idx + "]: useClientKey seat is missing "
                            + "clientKeyTag — the browser must tag every client-key seat so the server can "
                            + "name which locally-stored key to use");
                }
                out.setClientKeyTag(tag);
            }
        }
        String reasoningEffort = string(c, "reasoningEffort", idx);
        if (reasoningEffort != null && !"default".equals(reasoningEffort)) {
            out.setReasoningEffort(reasoningEffort); // "default" = leave null (server default)
        }
        List<String> levels = stringArray(c, "reasoningEffortLevels", idx);
        if (levels != null && !levels.isEmpty()) {
            out.setReasoningEffortLevels(levels); // null/empty = server default ladder
        }
        Boolean thinkingEnabled = bool(c, "thinkingEnabled", idx);
        if (thinkingEnabled != null) {
            out.setThinkingEnabled(thinkingEnabled);
        }
        Boolean temperatureEnabled = bool(c, "temperatureEnabled", idx);
        if (temperatureEnabled != null) {
            out.setTemperatureEnabled(temperatureEnabled);
        }
        Double temperature = number(c, "temperature", idx);
        if (temperature != null) {
            out.setTemperature(temperature);
        }
        Integer maxTokens = integer(c, "maxTokens", idx);
        if (maxTokens != null) {
            out.setMaxTokens(maxTokens);
        }
        Integer timeoutSeconds = integer(c, "timeoutSeconds", idx);
        if (timeoutSeconds != null) {
            out.setTimeoutSeconds(timeoutSeconds);
        }
        // ── Behavior ──
        Boolean streamingEnabled = bool(c, "streamingEnabled", idx);
        if (streamingEnabled != null) {
            out.setStreamingEnabled(streamingEnabled);
        }
        Boolean verboseLogging = bool(c, "verboseLogging", idx);
        if (verboseLogging != null) {
            out.setVerboseLogging(verboseLogging);
        }
        Boolean deckAssessmentEnabled = bool(c, "deckAssessmentEnabled", idx);
        if (deckAssessmentEnabled != null) {
            out.setDeckAssessmentEnabled(deckAssessmentEnabled);
        }
        Boolean concedeEnabled = bool(c, "concedeEnabled", idx);
        if (concedeEnabled != null) {
            out.setConcedeEnabled(concedeEnabled);
        }
        Boolean askReason = bool(c, "askReason", idx);
        if (askReason != null) {
            out.setAskReason(askReason);
        }
        String transcriptDir = string(c, "transcriptDir", idx);
        if (transcriptDir != null) {
            out.setTranscriptDir(transcriptDir);
        }
        // ── Personality ──
        Boolean personalityEnabled = bool(c, "personalityEnabled", idx);
        if (personalityEnabled != null) {
            out.setPersonalityEnabled(personalityEnabled);
        }
        String personalityName = string(c, "personalityName", idx);
        if (personalityName != null) {
            out.setPersonalityName(personalityName);
        }
        String botName = string(c, "botName", idx);
        if (botName != null) {
            out.setBotName(botName);
        }
        // ── Conversation ──
        Integer conversationMaxExchanges = integer(c, "conversationMaxExchanges", idx);
        if (conversationMaxExchanges != null) {
            out.setConversationMaxExchanges(conversationMaxExchanges);
        }
        Integer conversationMaxHistoryChars = integer(c, "conversationMaxHistoryChars", idx);
        if (conversationMaxHistoryChars != null) {
            out.setConversationMaxHistoryChars(conversationMaxHistoryChars);
        }
        Integer conversationThinkCharsPerMsg = integer(c, "conversationThinkCharsPerMsg", idx);
        if (conversationThinkCharsPerMsg != null) {
            out.setConversationThinkCharsPerMsg(conversationThinkCharsPerMsg);
        }
        // ── Summarization ──
        Integer summarizeTriggerChars = integer(c, "summarizeTriggerChars", idx);
        if (summarizeTriggerChars != null) {
            out.setSummarizeTriggerChars(summarizeTriggerChars);
        }
        Double summarizeContextRatio = number(c, "summarizeContextRatio", idx);
        if (summarizeContextRatio != null) {
            out.setSummarizeContextRatio(summarizeContextRatio);
        }
        // modelContextWindow: 0 means "auto-detect" server-side, so only explicit > 0 values
        // are applied (same rule as WebProxySession).
        Integer modelContextWindow = integer(c, "modelContextWindow", idx);
        if (modelContextWindow != null && modelContextWindow > 0) {
            out.setModelContextWindow(modelContextWindow);
        }
        Integer summarizeTargetChars = integer(c, "summarizeTargetChars", idx);
        if (summarizeTargetChars != null) {
            out.setSummarizeTargetChars(summarizeTargetChars);
        }
        Double summarizeTargetRatio = number(c, "summarizeTargetRatio", idx);
        if (summarizeTargetRatio != null) {
            out.setSummarizeTargetRatio(summarizeTargetRatio);
        }
        Integer summarizeKeepExchanges = integer(c, "summarizeKeepExchanges", idx);
        if (summarizeKeepExchanges != null) {
            out.setSummarizeKeepExchanges(summarizeKeepExchanges);
        }
        return out;
    }

    /**
     * Seat-endpoint validation (Fail Fast, public hosting): the per-seat endpoint is
     * client-controlled and the server-side seat dials it, so an unallowed host must never
     * reach {@code LLMPlayer.applyOverrides}. Same explicit allowlist as WebProxySession;
     * no silent fallback — the whole create request is rejected.
     */
    static String validatedEndpoint(String endpoint, int idx, Set<String> allowedModelHosts) {
        try {
            validateModelEndpoint(endpoint, allowedModelHosts);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("llmConfigs[" + idx + "]: " + ex.getMessage());
        }
        return endpoint;
    }

    /**
     * The endpoint policy on its own (no seat index), so other LLM verbs that dial a
     * client-supplied endpoint (the {@code fetchModels} list verb) reuse the exact same rule
     * instead of a second, drifting copy. Throws {@link IllegalArgumentException} with the
     * player-facing reason (no seat prefix, no operator-flag prefix).
     */
    static String validateModelEndpoint(String endpoint, Set<String> allowedModelHosts) {
        java.net.URI u;
        try {
            u = new java.net.URI(endpoint);
        } catch (java.net.URISyntaxException e) {
            throw new IllegalArgumentException("invalid apiEndpoint URL: " + endpoint);
        }
        String scheme = u.getScheme();
        if (scheme == null || (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
            throw new IllegalArgumentException("only http/https endpoints are allowed");
        }
        String host = u.getHost();
        // URI.getHost() keeps the brackets of an IPv6 literal ("[::1]") while operators list
        // the bare form ("::1"): strip them so the documented default entry actually matches.
        String bareHost = host;
        if (bareHost != null && bareHost.length() > 1 && bareHost.startsWith("[") && bareHost.endsWith("]")) {
            bareHost = bareHost.substring(1, bareHost.length() - 1);
        }
        if ("169.254.169.254".equals(bareHost) || "169.254.170.2".equals(bareHost)
                || "metadata.google.internal".equalsIgnoreCase(bareHost)) {
            throw new IllegalArgumentException("cloud metadata endpoints are blocked");
        }
        boolean allowed = false;
        if (allowedModelHosts != null) {
            for (String h : allowedModelHosts) {
                if (h.equalsIgnoreCase(bareHost)) {
                    allowed = true;
                    break;
                }
            }
        }
        if (!allowed) {
            throw new IllegalArgumentException("LLM endpoint host '" + host
                    + "' is not in the model-endpoint allowlist (--allowedModelHosts)");
        }
        return endpoint;
    }

    // ── Typed field readers: absent/null leaves null; wrong types are rejected loudly ──

    private static String string(JsonObject o, String key, int idx) {
        if (!o.has(key) || o.get(key).isJsonNull()) {
            return null;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException(field(idx, key) + " must be a string");
        }
        String s = v.getAsString();
        return s.isEmpty() ? null : s;
    }

    private static Boolean bool(JsonObject o, String key, int idx) {
        if (!o.has(key) || o.get(key).isJsonNull()) {
            return null;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isBoolean()) {
            throw new IllegalArgumentException(field(idx, key) + " must be a boolean");
        }
        return v.getAsBoolean();
    }

    private static Integer integer(JsonObject o, String key, int idx) {
        if (!o.has(key) || o.get(key).isJsonNull()) {
            return null;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(field(idx, key) + " must be a number");
        }
        return v.getAsInt();
    }

    private static Double number(JsonObject o, String key, int idx) {
        if (!o.has(key) || o.get(key).isJsonNull()) {
            return null;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(field(idx, key) + " must be a number");
        }
        return v.getAsDouble();
    }

    private static List<String> stringArray(JsonObject o, String key, int idx) {
        if (!o.has(key) || o.get(key).isJsonNull()) {
            return null;
        }
        JsonElement v = o.get(key);
        if (!v.isJsonArray()) {
            throw new IllegalArgumentException(field(idx, key) + " must be an array of strings");
        }
        List<String> out = new ArrayList<>();
        for (JsonElement e : v.getAsJsonArray()) {
            if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isString()
                    || e.getAsString().isEmpty()) {
                throw new IllegalArgumentException(field(idx, key) + " must contain non-empty strings");
            }
            out.add(e.getAsString());
        }
        return out;
    }

    private static String field(int idx, String key) {
        return "llmConfigs[" + idx + "]." + key;
    }
}
