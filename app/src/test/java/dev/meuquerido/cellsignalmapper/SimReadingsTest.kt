package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Made-up subscriptions and cells, built into samples as `docs/sample-schema.md` says. */
class SimReadingsTest {
    private val fix = Fix(
        lat = -15.5, lon = -47.5, accuracyM = 5f, altitudeM = null, verticalAccuracyM = null,
        timeMs = 1_000L, elapsedRealtimeMs = 2_000L, mock = false,
    )

    private val registeredCell = cellReading(
        Rat.LTE, registered = true, connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING,
        timestampMs = 2_000L, arfcn = 1650, pci = 101, mcc = "001", mnc = "01", ci = 1234L,
        tac = 42, rsrp = -90,
    )

    /** A neighbour on another carrier's network, which the sample keeps. */
    private val otherCarrierNeighbour = cellReading(
        Rat.LTE, registered = false, connectionStatus = CellInfo.CONNECTION_NONE,
        timestampMs = 2_000L, arfcn = 1650, pci = 205, mcc = "001", mnc = "02",
        ci = CellInfo.UNAVAILABLE_LONG, tac = CellInfo.UNAVAILABLE, rsrp = -109,
    )

    private fun sampleOf(sims: List<SimReading>) = sample(
        installId = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
        sessionId = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
        timeMs = 1_000L,
        elapsedRealtimeMs = 2_000L,
        fix = fix,
        sims = sims,
    )

    @Test
    fun twoSubscriptionsGiveABlockEachAndATimeoutGivesUnknownCells() = runBlocking {
        val answered = awaitCallback<List<CellReading>>(timeoutMs = 1_000L) { callback ->
            callback(listOf(registeredCell, otherCarrierNeighbour))
        }
        val silent = awaitCallback<List<CellReading>>(timeoutMs = 10L) { }

        val sample = sampleOf(
            listOf(
                simReading(
                    slotIndex = 0, simOperator = "00101", operatorNumeric = "00101",
                    operatorAlphaLong = "Network One", serviceState = ServiceStatus.IN_SERVICE,
                    cells = answered,
                ),
                simReading(
                    slotIndex = 1, simOperator = "00102", operatorNumeric = null,
                    operatorAlphaLong = null, serviceState = ServiceStatus.OUT_OF_SERVICE,
                    cells = silent,
                ),
            ),
        )

        assertNotNull(sample)
        assertEquals(SAMPLE_SCHEMA_VERSION, sample!!.schemaVersion)
        assertEquals(listOf(0, 1), sample.sims.map { it.slot })
        assertEquals(listOf(registeredCell, otherCarrierNeighbour), sample.sims[0].cells)
        assertEquals("00102", sample.sims[1].simPlmn)
        assertNull(sample.sims[1].cells)
    }

    @Test
    fun noActiveSubscriptionGivesNoSample() {
        assertNull(sampleOf(emptyList()))
    }

    @Test
    fun everySampleGetsItsOwnId() {
        val sims = listOf(
            simReading(
                slotIndex = 0, simOperator = "00101", operatorNumeric = "00101",
                operatorAlphaLong = null, serviceState = ServiceStatus.IN_SERVICE,
                cells = emptyList(),
            ),
        )

        assertNotEquals(sampleOf(sims)!!.id, sampleOf(sims)!!.id)
    }

    @Test
    fun anErrorGivesNull() = runBlocking {
        assertNull(awaitCallback<List<CellReading>>(timeoutMs = 1_000L) { callback -> callback(null) })
    }

    @Test
    fun aCallbackAfterTheTimeoutIsIgnored() = runBlocking {
        var late: ((List<CellReading>?) -> Unit)? = null
        val cells = awaitCallback<List<CellReading>>(timeoutMs = 10L) { callback -> late = callback }

        late!!(emptyList())

        assertNull(cells)
    }
}
