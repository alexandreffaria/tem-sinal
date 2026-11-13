package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationFixTest {
    private val now = 1_000_000L

    @Test
    fun fixFromThisMomentIsFresh() {
        assertTrue(isFixFresh(now, now))
    }

    @Test
    fun fixExactlyFifteenSecondsOldIsFresh() {
        assertTrue(isFixFresh(now - 15_000L, now))
    }

    @Test
    fun fixOlderThanFifteenSecondsIsMissing() {
        assertFalse(isFixFresh(now - 15_001L, now))
        assertFalse(isFixFresh(now - 60_000L, now))
    }
}
