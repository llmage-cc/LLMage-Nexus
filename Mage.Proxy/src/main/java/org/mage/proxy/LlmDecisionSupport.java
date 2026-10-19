package org.mage.proxy;

import mage.remote.SessionImpl;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.UUID;

/**
 * Compile-safe seam over the fork-only {@code SessionImpl.llmDecision(Decision)} /
 * {@code SessionImpl.llmError(Failure)} client-key bridge verbs.
 *
 * <p>Those methods (and the payload classes {@code mage.interfaces.LLMPromptPayload.Decision} /
 * {@code .Failure} they take) exist in the LLMage 1.4.62 artifacts this proxy is built against but
 * not in stock 1.4.62 / 1.5.8, so the bridge verbs may never be a hard compile-time call: the
 * two methods and the two payload constructors are resolved ONCE per JVM through reflection and
 * cached. When the running class does not carry them the seam reports unavailable and the caller
 * answers the typed {@code CAPABILITY_UNAVAILABLE} — the feature degrades instead of failing to
 * compile or breaking at runtime. Same pattern as {@link ReplaySeekSupport}.
 */
final class LlmDecisionSupport {

    private static final String SESSION_CLASS = "mage.remote.SessionImpl";
    private static final String PAYLOAD_CLASS = "mage.interfaces.LLMPromptPayload";
    private static final String DECISION_CLASS = PAYLOAD_CLASS + "$Decision";
    private static final String FAILURE_CLASS = PAYLOAD_CLASS + "$Failure";

    private static volatile boolean resolved = false;
    private static volatile Method decisionMethod;   // SessionImpl.llmDecision(Decision)
    private static volatile Method errorMethod;      // SessionImpl.llmError(Failure)
    private static volatile Constructor<?> decisionCtor; // Decision(UUID,String,String,int)
    private static volatile Constructor<?> failureCtor;  // Failure(UUID,String,boolean,int)

    private LlmDecisionSupport() {
    }

    private static void resolve() {
        if (!resolved) {
            synchronized (LlmDecisionSupport.class) {
                if (!resolved) {
                    Method dm = null;
                    Method em = null;
                    Constructor<?> dc = null;
                    Constructor<?> fc = null;
                    try {
                        Class<?> payload = Class.forName(PAYLOAD_CLASS);
                        Class<?> decision = Class.forName(DECISION_CLASS);
                        Class<?> failure = Class.forName(FAILURE_CLASS);
                        Class<?> session = Class.forName(SESSION_CLASS);
                        dm = session.getMethod("llmDecision", decision);
                        em = session.getMethod("llmError", failure);
                        dc = decision.getConstructor(UUID.class, String.class, String.class, int.class);
                        fc = failure.getConstructor(UUID.class, String.class, boolean.class, int.class);
                    } catch (ClassNotFoundException | NoSuchMethodException ex) {
                        dm = null;
                        em = null;
                        dc = null;
                        fc = null;
                    }
                    decisionMethod = dm;
                    errorMethod = em;
                    decisionCtor = dc;
                    failureCtor = fc;
                    resolved = true;
                }
            }
        }
    }

    /** True when the running class can deliver a decision/error: the gate that types the absence. */
    static boolean available() {
        resolve();
        return decisionMethod != null && errorMethod != null && decisionCtor != null && failureCtor != null;
    }

    /**
     * Constructs a {@code Decision} and invokes {@code session.llmDecision}. Only ever called after
     * {@link #available()}; a running class without the method answers {@code false} (never a raw
     * {@code NoSuchMethodError}).
     */
    static boolean decision(SessionImpl session, UUID requestId, String rawResponse, String thinking, int httpStatus) {
        resolve();
        if (decisionMethod == null || decisionCtor == null) {
            return false;
        }
        Object arg;
        try {
            arg = decisionCtor.newInstance(requestId, rawResponse, thinking, httpStatus);
        } catch (ReflectiveOperationException ex) {
            return false;
        }
        return invoke(decisionMethod, session, arg);
    }

    /** Constructs a {@code Failure} and invokes {@code session.llmError}. See {@link #decision}. */
    static boolean error(SessionImpl session, UUID requestId, String message, boolean retryable, int httpStatus) {
        resolve();
        if (errorMethod == null || failureCtor == null) {
            return false;
        }
        Object arg;
        try {
            arg = failureCtor.newInstance(requestId, message, retryable, httpStatus);
        } catch (ReflectiveOperationException ex) {
            return false;
        }
        return invoke(errorMethod, session, arg);
    }

    private static boolean invoke(Method m, SessionImpl session, Object arg) {
        try {
            Object result = m.invoke(session, arg);
            return result instanceof Boolean && (Boolean) result;
        } catch (IllegalAccessException ex) {
            throw new IllegalStateException(m.getName() + " is not accessible", ex);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            throw new IllegalStateException(m.getName() + " failed", cause);
        }
    }

    /** Test seam: pretend the running class carries (or lacks) the fork-only methods. */
    static void overrideForTest(Method decision, Method error, Constructor<?> decisionCtor,
                                Constructor<?> failureCtor) {
        decisionMethod = decision;
        errorMethod = error;
        LlmDecisionSupport.decisionCtor = decisionCtor;
        LlmDecisionSupport.failureCtor = failureCtor;
        resolved = true;
    }

    /** Test seam: forget the cached resolution and resolve again on the next use. */
    static void resetForTest() {
        resolved = false;
        decisionMethod = null;
        errorMethod = null;
        decisionCtor = null;
        failureCtor = null;
    }
}
