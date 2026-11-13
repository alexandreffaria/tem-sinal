package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo
import android.telephony.ServiceState.STATE_OUT_OF_SERVICE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/** Made-up ticks at an invented place, judged by [tickResult]. */
class TickResultTest {
    private val fix = Fix(
        lat = -15.5, lon = -47.5, accuracyM = 5f, altitudeM = null, verticalAccuracyM = null,
        timeMs = 1_000L, elapsedRealtimeMs = 2_000L, mock = false,
    )

    private val stayed: (Fix, Fix) -> Float = { _, _ -> 3f }
    private val moved: (Fix, Fix) -> Float = { _, _ -> 25f }

    private fun lte(rsrp: Int) = cellReading(
        Rat.LTE, registered = true, connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING,
        timestampMs = 2_000L, arfcn = 1650, pci = 101, mcc = "001", mnc = "01", ci = 1234L,
        tac = 42, rsrp = rsrp,
    )

    private fun sim(serviceState: ServiceStatus?, cells: List<CellReading>?) = simReading(
        slotIndex = 0, simOperator = "00101", operatorNumeric = null, operatorAlphaLong = null,
        serviceState = serviceState, cells = cells,
    )

    private fun sampleOf(vararg sims: SimReading) = sample(
        installId = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
        sessionId = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
        timeMs = 1_000L,
        elapsedRealtimeMs = 2_000L,
        fix = fix,
        sims = sims.toList(),
    )

    private val inService = sampleOf(sim(ServiceStatus.IN_SERVICE, listOf(lte(-90))))

    @Test
    fun aTickWithAFixAndNoSignalIsLogged() {
        val noSignal = sampleOf(sim(serviceStatus(STATE_OUT_OF_SERVICE, emptyList()), emptyList()))

        assertNotNull(noSignal)
        assertEquals(ServiceStatus.OUT_OF_SERVICE, noSignal!!.sims.single().serviceState)
        assertEquals(emptyList<CellReading>(), noSignal.sims.single().cells)
        assertEquals(PingResult.SUCCESS, tickResult(noSignal, null, stayed))
        assertEquals(PingResult.SUCCESS, tickResult(noSignal, inService, stayed))
    }

    @Test
    fun aTickWithoutAFixOrASubscriptionIsBad() {
        assertEquals(PingResult.BAD, tickResult(null, inService, stayed))
        assertEquals(PingResult.BAD, tickResult(sampleOf(), inService, stayed))
    }

    @Test
    fun theSameCoverageAtTheSamePlaceIsADuplicate() {
        val again = sampleOf(sim(ServiceStatus.IN_SERVICE, listOf(lte(-90))))

        assertEquals(PingResult.DUPLICATE, tickResult(again, inService, stayed))
        assertEquals(PingResult.SUCCESS, tickResult(again, inService, moved))
    }

    @Test
    fun emergencyOnlyAtAnInServicePlaceIsNotADuplicate() {
        val emergencyOnly = sampleOf(sim(ServiceStatus.EMERGENCY_ONLY, listOf(lte(-90))))

        assertEquals(PingResult.SUCCESS, tickResult(emergencyOnly, inService, stayed))
    }

    @Test
    fun aRepeatedNoSignalSpotIsADuplicate() {
        val noSignal = sampleOf(sim(ServiceStatus.OUT_OF_SERVICE, emptyList()))
        val again = sampleOf(sim(ServiceStatus.OUT_OF_SERVICE, emptyList()))

        assertEquals(PingResult.DUPLICATE, tickResult(again, noSignal, stayed))
    }

    @Test
    fun aChangedStrengthOrUnknownCellsIsNotADuplicate() {
        val weaker = sampleOf(sim(ServiceStatus.IN_SERVICE, listOf(lte(-95))))
        val unknownCells = sampleOf(sim(ServiceStatus.IN_SERVICE, null))

        assertEquals(PingResult.SUCCESS, tickResult(weaker, inService, stayed))
        assertEquals(PingResult.SUCCESS, tickResult(unknownCells, inService, stayed))
    }
}
