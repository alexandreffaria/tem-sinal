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
        overrideNetworkType = null,
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
    fun beforeLoggingShowsWaitingForReadings() {
        val state = LoggerUiState()

        assertEquals(UiText(R.string.getting_location), state.location)
        assertEquals(UiText(R.string.getting_signal_strength), state.signalStrength)
        assertEquals(emptyList<UiText>(), state.service)
    }

    @Test
    fun startingClearsReadingsAndMarksLogging() {
        val state = LoggerUiState().serviceStarted()

        assertTrue(state.isLogging)
        assertNull(state.location)
        assertNull(state.signalStrength)
        assertEquals(emptyList<UiText>(), state.service)
        assertNull(state.pingResult)
    }

    @Test
    fun sampleShowsReadingsAndCountsUp() {
        val sims = listOf(sim(0, ServiceStatus.IN_SERVICE, rsrp = -85))
        val state = LoggerUiState().serviceStarted()
            .withSample(-10.5, 20.25, sims, PingResult.SUCCESS)
            .withSample(-10.5, 20.25, sims, PingResult.SUCCESS)

        assertEquals(UiText(R.string.location, listOf("-10.5", "20.25")), state.location)
        assertEquals(UiText(R.string.signal_strength_dbm, listOf(-85)), state.signalStrength)
        assertEquals(
            listOf(UiText(R.string.sim_slot_service, listOf(1, UiText(R.string.in_service)))),
            state.service,
        )
        assertEquals(PingResult.SUCCESS, state.pingResult)
        assertEquals(2, state.sampleCount)
    }

    @Test
    fun tickWithoutLocationOrSignalShowsUnknown() {
        val state = LoggerUiState().serviceStarted()
            .withSample(null, null, emptyList(), PingResult.BAD)

        assertEquals(UiText(R.string.location, listOf("null", "null")), state.location)
        assertEquals(UiText(R.string.signal_strength_unknown), state.signalStrength)
        assertEquals(listOf(UiText(R.string.no_active_sim)), state.service)
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
            listOf(
                UiText(R.string.sim_slot_service, listOf(1, UiText(R.string.in_service))),
                UiText(R.string.sim_slot_service, listOf(2, UiText(R.string.emergency_calls_only))),
                UiText(R.string.sim_slot_service, listOf(3, UiText(R.string.no_service))),
                UiText(R.string.sim_slot_service, listOf(4, UiText(R.string.no_service_radio_off))),
                UiText(R.string.sim_service, listOf(UiText(R.string.service_unknown))),
            ),
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
        assertNull(stopped.location)
        assertNull(stopped.signalStrength)
        assertEquals(emptyList<UiText>(), stopped.service)
        assertEquals(stopped, stopped.withSample(3.0, 4.0, sims, PingResult.SUCCESS))
    }

    @Test
    fun indoorHintShowsWhileLoggingAndClearsOnStop() {
        val hinted = LoggerUiState().serviceStarted().withIndoorHint()

        assertEquals(UiText(R.string.indoor_hint), hinted.hint)
        assertNull(hinted.serviceStopped().hint)
    }

    @Test
    fun indoorHintAfterStopIsIgnored() {
        val stopped = LoggerUiState().serviceStarted().serviceStopped()

        assertEquals(stopped, stopped.withIndoorHint())
    }
}
