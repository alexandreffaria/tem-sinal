package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Test

class RecordWhileRegisteredTest {
    private val registration = Any()

    @Test
    fun registeredCallbackWritesItsValue() {
        val values = mutableMapOf<Int, Int>()
        recordWhileRegistered(mapOf(1 to registration), 1, { registration }, values, 5)
        assertEquals(mapOf(1 to 5), values)
    }

    @Test
    fun callbackAfterUnregisterWritesNothing() {
        val values = mutableMapOf<Int, Int>()
        recordWhileRegistered(emptyMap(), 1, { registration }, values, 5)
        assertEquals(emptyMap<Int, Int>(), values)
    }

    @Test
    fun callbackOfReplacedRegistrationWritesNothing() {
        val values = mutableMapOf(1 to 2)
        recordWhileRegistered(mapOf(1 to Any()), 1, { registration }, values, 5)
        assertEquals(mapOf(1 to 2), values)
    }
}
