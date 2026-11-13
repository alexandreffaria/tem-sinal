package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Made-up raw values, mapped as the CellReading table in `docs/sample-schema.md` says. */
class CellReadingTest {
    @Test
    fun lteKeepsInRangeValuesAndNullsUnavailableAndOutOfRangeOnes() {
        val cell = cellReading(
            Rat.LTE, registered = true, connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING,
            timestampMs = 86_399_500L,
            arfcn = 1650, pci = 101, mcc = "001", mnc = "01",
            ci = CellInfo.UNAVAILABLE.toLong(), tac = 4321,
            rsrp = -98, rsrq = CellInfo.UNAVAILABLE, sinr = 31, rssi = -67,
        )

        val expected = CellReading(
            source = CellSource.CELL_INFO, rat = Rat.LTE, registered = true,
            connection = CellConnection.PRIMARY_SERVING, timestampMs = 86_399_500L,
            arfcn = 1650, pci = 101, plmn = "00101", ci = null, tac = 4321,
            rsrp = -98, rsrq = null, sinr = null, rssi = -67, rscp = null, ecno = null,
        )
        assertEquals(expected, cell)
        assertEquals(-98, cell.headlineDbm())
    }

    @Test
    fun nrNullsUnavailableLongAndOutOfRangeStrength() {
        val cell = cellReading(
            Rat.NR, registered = false, connectionStatus = CellInfo.CONNECTION_SECONDARY_SERVING,
            timestampMs = 1_000L,
            arfcn = 3_279_165, pci = 1007, mcc = "001", mnc = "",
            ci = CellInfo.UNAVAILABLE_LONG, tac = CellInfo.UNAVAILABLE,
            rsrp = -157, rsrq = -12, sinr = 40,
        )

        val expected = CellReading(
            source = CellSource.CELL_INFO, rat = Rat.NR, registered = false,
            connection = CellConnection.SECONDARY_SERVING, timestampMs = 1_000L,
            arfcn = 3_279_165, pci = 1007, plmn = null, ci = null, tac = null,
            rsrp = null, rsrq = -12, sinr = 40, rssi = null, rscp = null, ecno = null,
        )
        assertEquals(expected, cell)
        assertNull(cell.headlineDbm())
    }

    @Test
    fun strengthATechnologyDoesNotHaveIsNull() {
        val gsm = cellReading(
            Rat.GSM, registered = true, connectionStatus = CellInfo.CONNECTION_UNKNOWN,
            timestampMs = 1_000L,
            arfcn = 10, pci = 64, mcc = null, mnc = null, ci = 65_535L, tac = 0,
            rsrp = -90, rssi = -75,
        )

        assertNull(gsm.connection)
        assertNull(gsm.pci)
        assertNull(gsm.rsrp)
        assertEquals(65_535L, gsm.ci)
        assertEquals(-75, gsm.headlineDbm())
    }

    @Test
    fun wcdmaHeadlineIsRscp() {
        val wcdma = cellReading(
            Rat.WCDMA, registered = true, connectionStatus = CellInfo.CONNECTION_NONE,
            timestampMs = 1_000L,
            arfcn = 10_700, pci = 511, mcc = "001", mnc = "01", ci = 268_435_456L, tac = 65_536,
            rscp = -24, ecno = -25,
        )

        assertEquals(CellConnection.NONE, wcdma.connection)
        assertNull(wcdma.ci)
        assertNull(wcdma.tac)
        assertNull(wcdma.ecno)
        assertEquals(-24, wcdma.headlineDbm())
    }

    @Test
    fun simWithInvalidSlotAndNoOperatorHasNulls() {
        val sim = simReading(slotIndex = -1, simOperator = "", cells = null)

        assertNull(sim.slot)
        assertNull(sim.simPlmn)
        assertNull(sim.cells)
        assertEquals(1, simReading(slotIndex = 1, simOperator = "00101", cells = emptyList()).slot)
    }
}
