package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StartLooksIndoorTest {
    @Test
    fun firstMinuteIsTwelveTicks() {
        assertEquals(12, START_TICKS)
    }

    @Test
    fun outdoorStartWithGoodFixesIsNotIndoor() {
        assertFalse(startLooksIndoor(List(START_TICKS) { 8f }))
    }

    @Test
    fun indoorStartWithNoFixesThenPoorAccuracyIsIndoor() {
        assertTrue(startLooksIndoor(List(6) { null } + List(6) { 120f }))
    }

    @Test
    fun startWithNoFixAtAllIsIndoor() {
        assertTrue(startLooksIndoor(List(START_TICKS) { null }))
    }

    @Test
    fun accuracyOfExactlyThirtyMetresIsGood() {
        assertFalse(startLooksIndoor(List(START_TICKS) { GOOD_ACCURACY_M }))
        assertTrue(startLooksIndoor(List(START_TICKS) { 30.1f }))
    }

    @Test
    fun halfTheTicksWithoutAGoodFixIsNotMost() {
        assertFalse(startLooksIndoor(List(6) { 50f } + List(6) { 10f }))
    }

    @Test
    fun sevenOfTwelveTicksWithoutAGoodFixIsMost() {
        assertTrue(startLooksIndoor(List(7) { 50f } + List(5) { 10f }))
    }

    @Test
    fun undecidedBeforeTheFirstMinuteEnds() {
        assertFalse(startLooksIndoor(List(START_TICKS - 1) { null }))
    }

    @Test
    fun ticksAfterTheFirstMinuteAreIgnored() {
        assertTrue(startLooksIndoor(List(START_TICKS) { null } + List(100) { 5f }))
        assertFalse(startLooksIndoor(List(START_TICKS) { 5f } + List(100) { null }))
    }
}
