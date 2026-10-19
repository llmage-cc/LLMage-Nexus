package org.mage.proxy;

import mage.remote.SessionImpl;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.UUID;

/**
 * Compile-safe seam over the fork-only {@code SessionImpl.seekTo(UUID,int)}.
 *
 * <p>{@code Replays.seekTo} exists in the LLMage 1.4.62 artifacts this proxy is built against,
 * but not in stock 1.4.62, so the replay scrubber may never be a hard compile-time call: the
 * method is resolved once per JVM through reflection and cached. When the running class does not
 * carry it the seam reports unavailable and the caller answers the typed
 * {@code CAPABILITY_UNAVAILABLE} — the feature degrades instead of failing to compile or
 * breaking at runtime. Once upstream lands a seek the resolution keeps working unchanged.
 */
final class ReplaySeekSupport {

    private static final String METHOD_NAME = "seekTo";
    private static final Class<?>[] PARAMETER_TYPES = new Class<?>[]{UUID.class, int.class};

    private static volatile Method seekTo;
    private static volatile boolean resolved = false;

    private ReplaySeekSupport() {
    }

    /** The cached method, or {@code null} when the running class has no seekTo. Resolved once. */
    static Method method() {
        if (!resolved) {
            synchronized (ReplaySeekSupport.class) {
                if (!resolved) {
                    Method found;
                    try {
                        found = SessionImpl.class.getMethod(METHOD_NAME, PARAMETER_TYPES);
                    } catch (NoSuchMethodException ex) {
                        found = null;
                    }
                    seekTo = found;
                    resolved = true;
                }
            }
        }
        return seekTo;
    }

    /** True when the running class can seek: the gate that turns absence into a typed error. */
    static boolean available() {
        return method() != null;
    }

    /**
     * Invokes the seam. Only ever called after {@link #available()}; a running class without the
     * method answers {@code false} (never a raw {@code NoSuchMethodError}).
     */
    static boolean seek(SessionImpl session, UUID gameId, int stateIndex) {
        Method m = method();
        if (m == null) {
            return false;
        }
        try {
            Object result = m.invoke(session, gameId, stateIndex);
            return result instanceof Boolean && (Boolean) result;
        } catch (IllegalAccessException ex) {
            throw new IllegalStateException("seekTo is not accessible", ex);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            throw new IllegalStateException("seekTo failed", cause);
        }
    }

    /** Test seam: pretend the running class carries (or lacks) the fork-only method. */
    static void overrideForTest(Method method) {
        seekTo = method;
        resolved = true;
    }

    /** Test seam: forget the cached resolution and resolve again on the next use. */
    static void resetForTest() {
        seekTo = null;
        resolved = false;
    }
}
