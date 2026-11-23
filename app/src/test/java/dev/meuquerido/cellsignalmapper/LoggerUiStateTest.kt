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

        assertEquals(UiText(R.string.getting_location), state.gps)
        assertEquals(UiText(R.string.getting_signal_strength), state.signalStrength)
        assertNull(state.sims)
    }

    @Test
    fun startingClearsReadingsAndMarksLogging() {
        val state = LoggerUiState().serviceStarted(SESSION, startedAtMs = 7_000L)

        assertTrue(state.isLogging)
        assertEquals(7_000L, state.startedAtMs)
        assertNull(state.gps)
        assertNull(state.signalStrength)
        assertNull(state.sims)
        assertNull(state.pingResult)
    }

    @Test
    fun sampleShowsReadings() {
        val sims = listOf(sim(0, ServiceStatus.IN_SERVICE, rsrp = -85))
        val state = LoggerUiState().serviceStarted(SESSION, 0L)
            .withSample(hasFix = true, accuracyM = 4.4f, sims, PingResult.SUCCESS)

        assertEquals(UiText(R.string.gps_accuracy, listOf(4)), state.gps)
        assertEquals(UiText(R.string.signal_strength_dbm, listOf(-85)), state.signalStrength)
        assertEquals(listOf(SimCard(UiText(R.string.sim_slot, listOf(1)), "4G", bars = 4)), state.sims)
        assertEquals(PingResult.SUCCESS, state.pingResult)
    }

    @Test
    fun fixWithoutAccuracyShowsGpsAlone() {
        val state = LoggerUiState().serviceStarted(SESSION, 0L)
            .withSample(hasFix = true, accuracyM = null, emptyList(), PingResult.BAD)

        assertEquals(UiText(R.string.gps), state.gps)
    }

    @Test
    fun tickWithoutLocationOrSignalShowsUnknown() {
        val state = LoggerUiState().serviceStarted(SESSION, 0L)
            .withSample(hasFix = false, accuracyM = null, emptyList(), PingResult.BAD)

        assertEquals(UiText(R.string.no_location_fix), state.gps)
        assertEquals(UiText(R.string.signal_strength_unknown), state.signalStrength)
        assertEquals(emptyList<SimCard>(), state.sims)
    }

    @Test
    fun everyServiceStateHasACard() {
        val chip = { n: Int -> UiText(R.string.sim_slot, listOf(n)) }

        assertEquals(SimCard(chip(1), NO_VALUE, detail = UiText(R.string.in_service)), simCard(sim(0, ServiceStatus.IN_SERVICE)))
        assertEquals(
            SimCard(chip(2), "SOS", emergency = true, detail = UiText(R.string.emergency_calls_only)),
            simCard(sim(1, ServiceStatus.EMERGENCY_ONLY)),
        )
        assertEquals(SimCard(chip(3), NO_VALUE, detail = UiText(R.string.no_service)), simCard(sim(2, ServiceStatus.OUT_OF_SERVICE)))
        assertEquals(
            SimCard(chip(4), NO_VALUE, detail = UiText(R.string.no_service_radio_off)),
            simCard(sim(3, ServiceStatus.POWER_OFF)),
        )
        assertEquals(SimCard(UiText(R.string.sim), NO_VALUE, detail = UiText(R.string.service_unknown)), simCard(sim(null, null)))
    }

    @Test
    fun cardNamesTheOperatorAndTheGeneration() {
        val lte = sim(0, ServiceStatus.IN_SERVICE, rsrp = -110).copy(operatorName = "Operadora Exemplo")

        assertEquals(
            SimCard(UiText(R.string.sim_operator, listOf(UiText(R.string.sim_slot, listOf(1)), "Operadora Exemplo")), "4G", bars = 2),
            simCard(lte),
        )
        assertEquals("5G", simCard(lte.copy(overrideNetworkType = OverrideNetworkType.NR_NSA)).value)
        assertEquals("5G", simCard(lte.copy(overrideNetworkType = OverrideNetworkType.NR_ADVANCED)).value)
        assertEquals("4G", simCard(lte.copy(overrideNetworkType = OverrideNetworkType.LTE_CA)).value)
    }

    @Test
    fun barsCountTheThresholdsReached() {
        fun cell(rat: Rat, dbm: Int) = cellReading(
            rat, registered = true, connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING, timestampMs = 0L,
            arfcn = 0, pci = 0, mcc = "001", mnc = "01", ci = 1L, tac = 1,
            rsrp = dbm, rssi = dbm, rscp = dbm,
        )

        assertEquals(0, cell(Rat.LTE, -129).signalBars())
        assertEquals(1, cell(Rat.LTE, -128).signalBars())
        assertEquals(4, cell(Rat.LTE, -98).signalBars())
        assertEquals(3, cell(Rat.NR, -80).signalBars())
        assertEquals(2, cell(Rat.WCDMA, -105).signalBars())
        assertEquals(4, cell(Rat.GSM, -89).signalBars())
        assertNull(cell(Rat.LTE, -200).signalBars())
    }

    @Test
    fun elapsedIsInWholeMinutesThenHours() {
        assertEquals(UiText(R.string.elapsed_minutes, listOf(0L)), elapsedText(59_999L))
        assertEquals(UiText(R.string.elapsed_minutes, listOf(42L)), elapsedText(42 * 60_000L + 30_000L))
        assertEquals(UiText(R.string.elapsed_hours, listOf(1L, 5L)), elapsedText(65 * 60_000L))
        assertEquals(UiText(R.string.elapsed_minutes, listOf(0L)), elapsedText(-5_000L))
    }

    @Test
    fun nextMinuteIsTheNextWholeMinuteOfTheRecording() {
        assertEquals(60_000L, msUntilNextMinute(0L))
        assertEquals(1L, msUntilNextMinute(59_999L))
        assertEquals(60_000L, msUntilNextMinute(60_000L))
        assertEquals(30_000L, msUntilNextMinute(42 * 60_000L + 30_000L))
        assertEquals(60_000L, msUntilNextMinute(-5_000L))
    }

    @Test
    fun stoppingClearsReadingsAndIgnoresLateSamples() {
        val sims = listOf(sim(0, ServiceStatus.IN_SERVICE, rsrp = -70))
        val stopped = LoggerUiState().serviceStarted(SESSION, 0L)
            .withSample(true, 3f, sims, PingResult.SUCCESS)
            .serviceStopped()

        assertFalse(stopped.isLogging)
        assertNull(stopped.startedAtMs)
        assertNull(stopped.gps)
        assertNull(stopped.signalStrength)
        assertNull(stopped.sims)
        assertEquals(stopped, stopped.withSample(true, 3f, sims, PingResult.SUCCESS))
    }

    @Test
    fun indoorHintShowsWhileLoggingAndClearsOnStop() {
        val hinted = LoggerUiState().serviceStarted(SESSION, 0L).withIndoorHint()

        assertEquals(UiText(R.string.indoor_hint), hinted.hint)
        assertNull(hinted.serviceStopped().hint)
    }

    @Test
    fun indoorHintAfterStopIsIgnored() {
        val stopped = LoggerUiState().serviceStarted(SESSION, 0L).serviceStopped()

        assertEquals(stopped, stopped.withIndoorHint())
    }

    @Test
    fun theRecordingBeingLoggedCanBeDeletedOnlyAfterStop() {
        val logging = LoggerUiState().serviceStarted(SESSION, 0L)

        assertFalse(logging.canDelete(SESSION))
        assertTrue(logging.canDelete(OTHER_SESSION))
        assertTrue(logging.serviceStopped().canDelete(SESSION))
    }

    private companion object {
        // Made-up session ids.
        const val SESSION = "3f6b2c9e-1a4d-4e8b-b7c2-9d0e5f1a6b83"
        const val OTHER_SESSION = "c81d4e2a-6f3b-4a9c-8e7d-2b5f0a9c3d16"
    }
}
