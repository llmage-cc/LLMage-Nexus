package org.mage.proxy;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the anon same-name collision guard. Key {@code host \0 port \0 usernameLower};
 * register-and-check atomic; same-browserId takeover allowed; both empty = old behaviour; release
 * identity-checked; scope per {@code host:port}.
 */
class AnonNameGuardTest {

    private AnonNameGuard guard;

    @BeforeEach
    void fresh() {
        guard = new AnonNameGuard();
    }

    private static Object owner() {
        return new Object();
    }

    @Test
    void aDifferentBrowserCannotTakeANameAlreadyHeldAtTheSameServer() {
        Object a = owner();
        Object b = owner();
        assertTrue(guard.checkAndRegister(a, "127.0.0.1", 17181, "Bob", "web:bob:1").allowed);

        AnonNameGuard.Decision refused = guard.checkAndRegister(b, "127.0.0.1", 17181, "Bob", "web:bob:2");
        assertFalse(refused.allowed, "a different browserId must be refused");
        assertNull(refused.active, "a refused connect owns nothing to release");
        assertEquals(1, guard.registeredCount(), "a refused connect leaves the map unchanged");
    }

    @Test
    void theUsernameIsCaseInsensitive() {
        Object a = owner();
        assertTrue(guard.checkAndRegister(a, "127.0.0.1", 17181, "Bob", "web:bob:1").allowed);
        assertFalse(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "bob", "web:x:2").allowed);
        assertFalse(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "BOB", "web:x:2").allowed);
    }

    @Test
    void theSameBrowserIdRetakeIsAllowedAndReplacesTheEntry() {
        Object old = owner();
        AnonNameGuard.ActiveConnect first =
                guard.checkAndRegister(old, "127.0.0.1", 17181, "Bob", "web:bob:1").active;
        AnonNameGuard.ActiveConnect retake =
                guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "web:bob:1").active;
        assertNotNull(retake, "a same-browserId retake is allowed");
        assertNotSame(first, retake, "the retake installs a fresh entry that replaces the old one");
        assertEquals(1, guard.registeredCount());

        // the dying holder's identity-checked release must NOT drop the newer entry
        guard.release(first);
        assertEquals(1, guard.registeredCount(), "the older holder's release no-ops against the newer entry");
        assertFalse(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "web:other:9").allowed,
                "the newer entry is still held");
    }

    @Test
    void bothEmptyBrowserIdsDoNotBlock() {
        // old clients / direct WS probes carry no browserId: the guard must not wedge them
        assertTrue(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "").allowed);
        AnonNameGuard.Decision second = guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "");
        assertTrue(second.allowed, "two empty browserIds never block");
        assertNull(second.active, "the legacy holder owns no releasable entry");
    }

    @Test
    void anEmptyBrowserIdDoesNotTakeOverAHolderWithABrowserId() {
        assertTrue(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "web:bob:1").allowed);
        assertFalse(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "").allowed,
                "an empty browserId is not the same browser as web:bob:1");
    }

    @Test
    void releaseIsIdentityCheckedAndIdempotent() {
        AnonNameGuard.ActiveConnect held =
                guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "web:bob:1").active;
        guard.release(held);
        assertEquals(0, guard.registeredCount());
        guard.release(held); // idempotent
        assertEquals(0, guard.registeredCount());
        assertTrue(guard.checkAndRegister(owner(), "127.0.0.1", 17181, "Bob", "web:other:9").allowed,
                "the name is free again after release");
    }

    @Test
    void aNameCollidesOnlyPerHostPort() {
        assertTrue(guard.checkAndRegister(owner(), "serverA", 17171, "Bob", "web:a:1").allowed);
        assertTrue(guard.checkAndRegister(owner(), "serverB", 17171, "Bob", "web:b:2").allowed,
                "the same name on another server must not be blocked");
        assertTrue(guard.checkAndRegister(owner(), "serverA", 17172, "Bob", "web:a:3").allowed,
                "the same name on another port must not be blocked");
        assertEquals(3, guard.registeredCount());
    }

    @Test
    void reRegistrationByTheSameOwnerIsAllowed() {
        Object owner = owner();
        AnonNameGuard.ActiveConnect first =
                guard.checkAndRegister(owner, "127.0.0.1", 17181, "Bob", "web:bob:1").active;
        AnonNameGuard.Decision again = guard.checkAndRegister(owner, "127.0.0.1", 17181, "Bob", "web:bob:1");
        assertTrue(again.allowed);
        assertSame(first, again.active, "the original entry stands");
    }

    @Test
    void aNullOwnerNeverMatchesAnotherNullOwner() {
        // unit tests drive the guard without a session; null == null must not let every ownerless
        // probe take any name over
        assertTrue(guard.checkAndRegister(null, "127.0.0.1", 17181, "Bob", "web:bob:1").allowed);
        assertFalse(guard.checkAndRegister(null, "127.0.0.1", 17181, "Bob", "web:bob:2").allowed,
                "two different browserIds must not collide just because both owners are null");
    }
}
