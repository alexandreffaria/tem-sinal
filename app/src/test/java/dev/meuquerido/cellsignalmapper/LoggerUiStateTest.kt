package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggerUiStateTest {
    @Test
    fun startingClearsReadingsAndMarksLogging() {
        val state = LoggerUiState().serviceStarted()

        assertTrue(state.isLogging)
        assertEquals("", state.location)
        assertEquals("", state.signalStrength)
        assertNull(state.pingResult)
    }

    @Test
    fun sampleShowsReadingsAndCountsUp() {
        val state = LoggerUiState().serviceStarted()
            .withSample(-10.5, 20.25, -85, PingResult.SUCCESS)
            .withSample(-10.5, 20.25, -85, PingResult.DUPLICATE)

        assertEquals("Lat: -10.5, Lon: 20.25", state.location)
        assertEquals("Signal Strength: -85 dBm", state.signalStrength)
        assertEquals(PingResult.DUPLICATE, state.pingResult)
        assertEquals(2, state.sampleCount)
    }

    @Test
    fun tickWithoutLocationOrSignalShowsUnknown() {
        val state = LoggerUiState().serviceStarted().withSample(null, null, null, PingResult.BAD)

        assertEquals("Lat: null, Lon: null", state.location)
        assertEquals("Signal Strength: unknown", state.signalStrength)
    }

    @Test
    fun stoppingClearsReadingsAndIgnoresLateSamples() {
        val stopped = LoggerUiState().serviceStarted()
            .withSample(1.0, 2.0, -70, PingResult.SUCCESS)
            .serviceStopped()

        assertFalse(stopped.isLogging)
        assertEquals("", stopped.location)
        assertEquals("", stopped.signalStrength)
        assertEquals(stopped, stopped.withSample(3.0, 4.0, -60, PingResult.SUCCESS))
    }
}
