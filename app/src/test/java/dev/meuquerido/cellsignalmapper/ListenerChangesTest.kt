package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Test

class ListenerChangesTest {
    @Test
    fun registersNewlyActiveSubscriptions() {
        assertEquals(
            ListenerChanges(add = setOf(2), remove = emptySet()),
            listenerChanges(activeIds = setOf(1, 2), registeredIds = setOf(1)),
        )
    }

    @Test
    fun unregistersSubscriptionsNoLongerActive() {
        assertEquals(
            ListenerChanges(add = emptySet(), remove = setOf(2)),
            listenerChanges(activeIds = setOf(1), registeredIds = setOf(1, 2)),
        )
    }

    @Test
    fun swappedSimIsUnregisteredAndItsReplacementRegistered() {
        assertEquals(
            ListenerChanges(add = setOf(3), remove = setOf(2)),
            listenerChanges(activeIds = setOf(1, 3), registeredIds = setOf(1, 2)),
        )
    }

    @Test
    fun noActiveSubscriptionUnregistersAll() {
        assertEquals(
            ListenerChanges(add = emptySet(), remove = setOf(1, 2)),
            listenerChanges(activeIds = emptySet(), registeredIds = setOf(1, 2)),
        )
    }

    @Test
    fun unchangedSubscriptionsChangeNothing() {
        assertEquals(
            ListenerChanges(add = emptySet(), remove = emptySet()),
            listenerChanges(activeIds = setOf(1, 2), registeredIds = setOf(1, 2)),
        )
    }
}
