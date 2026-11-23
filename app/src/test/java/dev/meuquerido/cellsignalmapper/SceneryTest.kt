package dev.meuquerido.cellsignalmapper

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneryTest {
    @Test
    fun flocksAreSmallComeEvery20To30SecondsAndStayInTheirBand() {
        val flocks = List(2_000) { nextFlock(Random(it)) }

        assertTrue(flocks.all { it.birds in 1..3 && it.waitMs in 20_000L..30_000L && it.top in 0.2f..0.8f })
        assertEquals(setOf(1, 2, 3), flocks.map { it.birds }.toSet())
    }

    @Test
    fun reduceMotionStopsTheBirds() {
        assertFalse(birdsAllowed(0f))
        assertTrue(birdsAllowed(0.5f))
        assertTrue(birdsAllowed(1f))
    }
}
