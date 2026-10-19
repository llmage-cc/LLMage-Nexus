package org.mage.proxy;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Compile-safe seam over the fork-only {@code mage.cards.decks.P1DeckPool}.
 *
 * <p>{@code P1DeckPool} exists in the LLMage 1.4.62 artifacts this proxy is built against, but it is
 * ABSENT in stock 1.4.62 / 1.5.8, so the {@code getP1Decks} verb may never be a hard compile-time
 * call: the class and its three reader methods ({@code instance()}, {@code deckNames()},
 * {@code deckText(String)}, {@code defaultDeckName()}) are resolved ONCE per JVM through reflection
 * and cached. When the running class does not carry them the seam reports unavailable and the
 * caller answers the typed {@code CAPABILITY_UNAVAILABLE} — the feature degrades instead of failing
 * to compile or breaking at runtime. Same pattern as {@link ReplaySeekSupport}.
 *
 * <p>Data shape mirrors {@code P1DeckOffering.decksMessage()}: the pool's 55 deck names, each deck's
 * text, and the deterministic default name.
 */
final class P1DeckSupport {

    private static final String POOL_CLASS = "mage.cards.decks.P1DeckPool";

    private static volatile boolean resolved = false;
    private static volatile Method instanceMethod;       // P1DeckPool.instance()
    private static volatile Method deckNamesMethod;      // P1DeckPool.deckNames()
    private static volatile Method deckTextMethod;       // P1DeckPool.deckText(String)
    private static volatile Method defaultDeckNameMethod; // P1DeckPool.defaultDeckName()

    private P1DeckSupport() {
    }

    private static void resolve() {
        if (!resolved) {
            synchronized (P1DeckSupport.class) {
                if (!resolved) {
                    Method inst = null;
                    Method names = null;
                    Method text = null;
                    Method def = null;
                    try {
                        Class<?> pool = Class.forName(POOL_CLASS);
                        inst = pool.getMethod("instance");
                        names = pool.getMethod("deckNames");
                        text = pool.getMethod("deckText", String.class);
                        def = pool.getMethod("defaultDeckName");
                    } catch (ClassNotFoundException | NoSuchMethodException ex) {
                        inst = null;
                        names = null;
                        text = null;
                        def = null;
                    }
                    instanceMethod = inst;
                    deckNamesMethod = names;
                    deckTextMethod = text;
                    defaultDeckNameMethod = def;
                    resolved = true;
                }
            }
        }
    }

    /** True when the running class can serve the deck pool: the gate that types the absence. */
    static boolean available() {
        resolve();
        return instanceMethod != null && deckNamesMethod != null
                && deckTextMethod != null && defaultDeckNameMethod != null;
    }

    /** One deck row: its name and its canonical deck text. */
    static final class Deck {
        final String name;
        final String deck;

        Deck(String name, String deck) {
            this.name = name;
            this.deck = deck;
        }
    }

    /** The pool's decks (name + text) in pool order, or {@code null} when the class is absent. */
    static List<Deck> decks() {
        resolve();
        if (instanceMethod == null || deckNamesMethod == null
                || deckTextMethod == null || defaultDeckNameMethod == null) {
            return null;
        }
        try {
            Object pool = instanceMethod.invoke(null);
            if (pool == null) {
                return null;
            }
            Object namesRaw = deckNamesMethod.invoke(pool);
            if (!(namesRaw instanceof List)) {
                return null;
            }
            List<Deck> out = new ArrayList<>();
            for (Object nameObj : (List<?>) namesRaw) {
                String name = nameObj == null ? null : nameObj.toString();
                if (name == null) {
                    continue;
                }
                Object textRaw = deckTextMethod.invoke(pool, name);
                out.add(new Deck(name, textRaw == null ? "" : textRaw.toString()));
            }
            return out;
        } catch (IllegalAccessException ex) {
            throw new IllegalStateException("P1DeckPool is not accessible", ex);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            throw new IllegalStateException("P1DeckPool read failed", cause);
        }
    }

    /** The pool's deterministic default deck name, or {@code null} when the class is absent. */
    static String defaultDeckName() {
        resolve();
        if (instanceMethod == null || defaultDeckNameMethod == null) {
            return null;
        }
        try {
            Object pool = instanceMethod.invoke(null);
            if (pool == null) {
                return null;
            }
            Object def = defaultDeckNameMethod.invoke(pool);
            return def == null ? null : def.toString();
        } catch (IllegalAccessException ex) {
            throw new IllegalStateException("P1DeckPool is not accessible", ex);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            throw new IllegalStateException("P1DeckPool read failed", cause);
        }
    }

    /** Test seam: pretend the running class carries (or lacks) the fork-only pool. */
    static void overrideForTest(Method instance, Method deckNames, Method deckText, Method defaultName) {
        instanceMethod = instance;
        deckNamesMethod = deckNames;
        deckTextMethod = deckText;
        defaultDeckNameMethod = defaultName;
        resolved = true;
    }

    /** Test seam: forget the cached resolution and resolve again on the next use. */
    static void resetForTest() {
        resolved = false;
        instanceMethod = null;
        deckNamesMethod = null;
        deckTextMethod = null;
        defaultDeckNameMethod = null;
    }

    /** Test seam: the deck names of the current resolution, or an empty list when absent. */
    static List<String> names() {
        List<Deck> decks = decks();
        if (decks == null) {
            return Collections.emptyList();
        }
        List<String> out = new ArrayList<>();
        for (Deck d : decks) {
            out.add(d.name);
        }
        return out;
    }
}
