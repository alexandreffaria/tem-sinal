package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StartLooksIndoorTest {
    /** [count] ticks with [accuracyM] and, unless given, as many satellites as an open sky gives. */
    private fun ticks(count: Int, accuracyM: Float?, satellitesUsed: Int = 11) =
        List(count) { StartTick(accuracyM, satellitesUsed) }

    @Test
    fun firstMinuteIsTwelveTicks() {
        assertEquals(12, START_TICKS)
    }

    @Test
    fun outdoorStartWithGoodFixesIsNotIndoor() {
        assertFalse(startLooksIndoor(ticks(START_TICKS, 8f)))
    }

    @Test
    fun indoorStartWithNoFixesThenPoorAccuracyIsIndoor() {
        assertTrue(startLooksIndoor(ticks(6, null) + ticks(6, 120f)))
    }

    @Test
    fun startWithNoFixAtAllIsIndoor() {
        assertTrue(startLooksIndoor(ticks(START_TICKS, null)))
    }

    @Test
    fun accuracyOfExactlyThirtyMetresIsGood() {
        assertFalse(startLooksIndoor(ticks(START_TICKS, GOOD_ACCURACY_M)))
        assertTrue(startLooksIndoor(ticks(START_TICKS, 30.1f)))
    }

    @Test
    fun wifiFixesWithGoodAccuracyAndNoSatellitesAreIndoor() {
        assertTrue(startLooksIndoor(ticks(START_TICKS, 15f, satellitesUsed = 0)))
    }

    @Test
    fun fourSatellitesUsedIsGood() {
        assertFalse(startLooksIndoor(ticks(START_TICKS, 8f, satellitesUsed = GOOD_SATELLITES_USED)))
        assertTrue(startLooksIndoor(ticks(START_TICKS, 8f, satellitesUsed = 3)))
    }

    @Test
    fun aGpsFixArrivingSecondsInIsNotIndoor() {
        assertFalse(startLooksIndoor(ticks(2, 15f, satellitesUsed = 0) + ticks(10, 5f)))
    }

    @Test
    fun halfTheTicksWithoutAGoodFixIsNotMost() {
        assertFalse(startLooksIndoor(ticks(6, 50f) + ticks(6, 10f)))
        assertFalse(startLooksIndoor(ticks(6, 10f, satellitesUsed = 0) + ticks(6, 10f)))
    }

    @Test
    fun sevenOfTwelveTicksWithoutAGoodFixIsMost() {
        assertTrue(startLooksIndoor(ticks(7, 50f) + ticks(5, 10f)))
        assertTrue(startLooksIndoor(ticks(7, 10f, satellitesUsed = 0) + ticks(5, 10f)))
    }

    @Test
    fun undecidedBeforeTheFirstMinuteEnds() {
        assertFalse(startLooksIndoor(ticks(START_TICKS - 1, null)))
    }

    @Test
    fun ticksAfterTheFirstMinuteAreIgnored() {
        assertTrue(startLooksIndoor(ticks(START_TICKS, null) + ticks(100, 5f)))
        assertFalse(startLooksIndoor(ticks(START_TICKS, 5f) + ticks(100, null)))
    }
}
