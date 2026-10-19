package org.mage.proxy;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import mage.interfaces.callback.ClientCallbackMethod;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Client-key prompt bridge, payload side: turns a fork-only {@code LLM_PROMPT}
 * callback into the TYPED {@code llm_prompt} frame INSTEAD of the generic {@code event} envelope.
 *
 * <p>{@code mage.interfaces.LLMPromptPayload} is fork-only (absent in stock 1.4.62 and 1.5.8), so
 * its fields are read by REFLECTION, resolving the class and its public final fields ONCE and
 * caching. The callback is compared by {@code m.name().equals("LLM_PROMPT")} — never a hard
 * compile-time {@code case} — so a stock build (no such enum constant) still compiles. When the
 * class is absent the callback never arrives; if it somehow does, it is logged and skipped.
 *
 * <p>An object payload (the real fork type) or a {@code Map} is handled; anything else is logged
 * and skipped. The frame carries NO key — the browser attaches its own.
 *
 * <pre>
 * {"type":"llm_prompt","requestId","seatId","gameId","playerName","requestBody","apiEndpoint",
 *  "stream","timeoutSeconds","clientKeyTag"}
 * </pre>
 */
final class LlmPromptBridge {

    static final String FRAME_TYPE = "llm_prompt";
    static final String PAYLOAD_CLASS = "mage.interfaces.LLMPromptPayload";
    /** The enum constant of the fork-only callback, matched by name so a stock build compiles. */
    static final String PROMPT_METHOD = "LLM_PROMPT";

    /** The public final fields of {@code LLMPromptPayload}, in the frame's order. */
    static final String[] FIELDS = {
            "requestId", "seatId", "gameId", "playerName", "requestBody",
            "apiEndpoint", "stream", "timeoutSeconds", "clientKeyTag"
    };

    private static final Logger logger = Logger.getLogger(LlmPromptBridge.class.getName());

    private static volatile boolean resolved = false;
    private static volatile Class<?> payloadClass;
    /** Parallel to {@link #FIELDS}; an entry is {@code null} when the running class lacks it. */
    private static volatile Field[] fields;

    private LlmPromptBridge() {
    }

    /** True when a callback is the fork-only {@code LLM_PROMPT} (compared by name, never a case). */
    static boolean isLlmPrompt(ClientCallbackMethod m) {
        return m != null && PROMPT_METHOD.equals(m.name());
    }

    /**
     * The typed {@code llm_prompt} frame for a callback payload, or {@code null} when the payload
     * cannot be read (logged). Never throws.
     */
    static String frame(Object data) {
        if (data == null) {
            logger.warning("LLM_PROMPT arrived with no payload — skipped");
            return null;
        }
        JsonObject out = new JsonObject();
        out.addProperty("type", FRAME_TYPE);
        if (data instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) data;
            for (String name : FIELDS) {
                put(out, name, map.get(name));
            }
            return out.toString();
        }
        Class<?> cls = resolve();
        if (cls == null) {
            logger.warning("LLM_PROMPT arrived but " + PAYLOAD_CLASS + " is absent from this build — skipped");
            return null;
        }
        if (!cls.isInstance(data)) {
            logger.warning("LLM_PROMPT with unexpected payload type: " + data.getClass().getName() + " — skipped");
            return null;
        }
        Field[] fs = fields;
        for (int i = 0; i < FIELDS.length; i++) {
            Object value = null;
            if (fs != null && fs[i] != null) {
                try {
                    value = fs[i].get(data);
                } catch (IllegalAccessException ex) {
                    value = null;
                }
            }
            put(out, FIELDS[i], value);
        }
        return out.toString();
    }

    /** Resolves the payload class + its fields once; caches. Returns the class, or null if absent. */
    private static Class<?> resolve() {
        if (!resolved) {
            synchronized (LlmPromptBridge.class) {
                if (!resolved) {
                    Class<?> cls;
                    try {
                        cls = Class.forName(PAYLOAD_CLASS);
                    } catch (ClassNotFoundException ex) {
                        cls = null;
                    }
                    Field[] fs = new Field[FIELDS.length];
                    if (cls != null) {
                        for (int i = 0; i < FIELDS.length; i++) {
                            try {
                                fs[i] = cls.getField(FIELDS[i]);
                            } catch (NoSuchFieldException ex) {
                                fs[i] = null;
                            }
                        }
                    }
                    payloadClass = cls;
                    fields = fs;
                    resolved = true;
                }
            }
        }
        return payloadClass;
    }

    /** Adds a JSON property of the right primitive kind; a null value becomes JSON null. */
    private static void put(JsonObject out, String name, Object value) {
        if (value == null) {
            out.add(name, JsonNull.INSTANCE);
        } else if (value instanceof Boolean) {
            out.addProperty(name, (Boolean) value);
        } else if (value instanceof Number) {
            out.addProperty(name, (Number) value);
        } else {
            out.addProperty(name, String.valueOf(value));
        }
    }

    /** Test seam: pretend the running class carries the payload class (or lacks it with null). */
    static void overrideForTest(Class<?> cls) {
        Field[] fs = new Field[FIELDS.length];
        if (cls != null) {
            for (int i = 0; i < FIELDS.length; i++) {
                try {
                    fs[i] = cls.getField(FIELDS[i]);
                } catch (NoSuchFieldException ex) {
                    fs[i] = null;
                }
            }
        }
        payloadClass = cls;
        fields = fs;
        resolved = true;
    }

    /** Test seam: forget the cached resolution and resolve again on the next use. */
    static void resetForTest() {
        resolved = false;
        payloadClass = null;
        fields = null;
    }
}
