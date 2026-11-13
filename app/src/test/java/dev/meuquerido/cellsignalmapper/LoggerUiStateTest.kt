package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggerUiStateTest {
    /** A made-up SIM with one registered LTE cell at [rsrp], or no cells when it is null. */
    private fun sim(slot: Int?, serviceState: ServiceStatus?, rsrp: Int? = null) = simReading(
        slotIndex = slot, simOperator = "00101", operatorNumeric = null, operatorAlphaLong = null,
        serviceState = serviceState,
        cells = listOfNotNull(
            rsrp?.let {
                cellReading(
                    Rat.LTE, registered = true,
                    connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING, timestampMs = 2_000L,
                    arfcn = 1650, pci = 101, mcc = "001", mnc = "01", ci = 1234L, tac = 42,
                    rsrp = it,
                )
            },
        ),
    )

    @Test
    fun startingClearsReadingsAndMarksLogging() {
        val state = LoggerUiState().serviceStarted()

        assertTrue(state.isLogging)
        assertEquals("", state.location)
        assertEquals("", state.signalStrength)
        assertEquals("", state.service)
        assertNull(state.pingResult)
    }

    @Test
    fun sampleShowsReadingsAndCountsUp() {
        val sims = listOf(sim(0, ServiceStatus.IN_SERVICE, rsrp = -85))
        val state = LoggerUiState().serviceStarted()
            .withSample(-10.5, 20.25, sims, PingResult.SUCCESS)
            .withSample(-10.5, 20.25, sims, PingResult.DUPLICATE)

        assertEquals("Lat: -10.5, Lon: 20.25", state.location)
        assertEquals("Signal Strength: -85 dBm", state.signalStrength)
        assertEquals("SIM 1: In service", state.service)
        assertEquals(PingResult.DUPLICATE, state.pingResult)
        assertEquals(2, state.sampleCount)
    }

    @Test
    fun tickWithoutLocationOrSignalShowsUnknown() {
        val state = LoggerUiState().serviceStarted()
            .withSample(null, null, emptyList(), PingResult.BAD)

        assertEquals("Lat: null, Lon: null", state.location)
        assertEquals("Signal Strength: unknown", state.signalStrength)
        assertEquals("No active SIM", state.service)
    }

    @Test
    fun everyServiceStateHasPlainWordsPerSim() {
        val text = serviceText(
            listOf(
                sim(0, ServiceStatus.IN_SERVICE),
                sim(1, ServiceStatus.EMERGENCY_ONLY),
                sim(2, ServiceStatus.OUT_OF_SERVICE),
                sim(3, ServiceStatus.POWER_OFF),
                sim(null, null),
            ),
        )

        assertEquals(
            "SIM 1: In service\n" +
                "SIM 2: Emergency calls only\n" +
                "SIM 3: No service\n" +
                "SIM 4: No service (radio off)\n" +
                "SIM: Service unknown",
            text,
        )
    }

    @Test
    fun stoppingClearsReadingsAndIgnoresLateSamples() {
        val sims = listOf(sim(0, ServiceStatus.IN_SERVICE, rsrp = -70))
        val stopped = LoggerUiState().serviceStarted()
            .withSample(1.0, 2.0, sims, PingResult.SUCCESS)
            .serviceStopped()

        assertFalse(stopped.isLogging)
        assertEquals("", stopped.location)
        assertEquals("", stopped.signalStrength)
        assertEquals("", stopped.service)
        assertEquals(stopped, stopped.withSample(3.0, 4.0, sims, PingResult.SUCCESS))
    }
}
