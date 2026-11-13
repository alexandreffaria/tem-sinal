package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo
import android.telephony.TelephonyDisplayInfo
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
        val sim = simReading(
            slotIndex = -1, simOperator = "", operatorNumeric = "", operatorAlphaLong = null,
            serviceState = null, overrideNetworkType = null, cells = null,
        )

        assertNull(sim.slot)
        assertNull(sim.simPlmn)
        assertNull(sim.registeredPlmn)
        assertNull(sim.operatorName)
        assertNull(sim.serviceState)
        assertNull(sim.cells)
    }

    @Test
    fun roamingSimKeepsItsOwnAndTheRegisteredPlmn() {
        val sim = simReading(
            slotIndex = 1, simOperator = "00101", operatorNumeric = "00102",
            operatorAlphaLong = "Other Network", serviceState = ServiceStatus.IN_SERVICE,
            overrideNetworkType = null, cells = emptyList(),
        )

        assertEquals(1, sim.slot)
        assertEquals("00101", sim.simPlmn)
        assertEquals("00102", sim.registeredPlmn)
        assertEquals("Other Network", sim.operatorName)
        assertEquals(ServiceStatus.IN_SERVICE, sim.serviceState)
        assertEquals(emptyList<CellReading>(), sim.cells)
    }

    @Test
    fun plmnIsKeptOnlyWhenFiveOrSixDigits() {
        assertEquals("72406", plmnOrNull("72406"))
        assertEquals("724031", plmnOrNull("724031"))
        for (bad in listOf("7240", "7240611", "724ab", " 72406", "", null)) {
            assertNull(bad, plmnOrNull(bad))
        }
    }

    @Test
    fun simAndCellPlmnsThatAreNotFiveOrSixDigitsAreNull() {
        val sim = simReading(
            slotIndex = 0, simOperator = "7240", operatorNumeric = "724ab",
            operatorAlphaLong = null, serviceState = null, overrideNetworkType = null, cells = null,
        )
        assertNull(sim.simPlmn)
        assertNull(sim.registeredPlmn)

        assertEquals("72406", plmnOf("724", "06"))
        assertEquals("724031", plmnOf("724", "031"))
        assertNull(plmnOf("724", "0611"))
        assertNull(plmnOf("72", "06"))
        assertNull(plmnOf("724", " 6"))
    }

    private val lteAnchor = cellReading(
        Rat.LTE, registered = true, connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING,
        timestampMs = 1_000L,
        arfcn = 1650, pci = 101, mcc = "001", mnc = "01", ci = 1234L, tac = 42, rsrp = -98,
    )

    @Test
    fun nsaWithoutCellInfoNrGetsTheNrLegFromSignalStrength() {
        val leg = nrSignalStrengthLeg(ssRsrp = -102, ssRsrq = CellInfo.UNAVAILABLE, ssSinr = 41)

        val expected = CellReading(
            source = CellSource.SIGNAL_STRENGTH, rat = Rat.NR, registered = false,
            connection = CellConnection.SECONDARY_SERVING, timestampMs = null,
            arfcn = null, pci = null, plmn = null, ci = null, tac = null,
            rsrp = -102, rsrq = null, sinr = null, rssi = null, rscp = null, ecno = null,
        )
        assertEquals(expected, leg)
        assertEquals(listOf(lteAnchor, expected), cellsWithNrLeg(listOf(lteAnchor), leg))
    }

    @Test
    fun nsaWithCellInfoNrGetsNoSecondNrLeg() {
        val cellInfoNr = cellReading(
            Rat.NR, registered = false, connectionStatus = CellInfo.CONNECTION_SECONDARY_SERVING,
            timestampMs = 1_000L,
            arfcn = 640_000, pci = 500, mcc = null, mnc = null,
            ci = CellInfo.UNAVAILABLE_LONG, tac = CellInfo.UNAVAILABLE, rsrp = -100,
        )
        val leg = nrSignalStrengthLeg(ssRsrp = -102, ssRsrq = -12, ssSinr = 4)

        val cells = listOf(lteAnchor, cellInfoNr)
        assertEquals(cells, cellsWithNrLeg(cells, leg))
    }

    @Test
    fun noNrLegWithoutAnSsValueOrWithoutCellInfo() {
        assertNull(
            nrSignalStrengthLeg(
                ssRsrp = CellInfo.UNAVAILABLE, ssRsrq = CellInfo.UNAVAILABLE,
                ssSinr = CellInfo.UNAVAILABLE,
            ),
        )
        assertEquals(listOf(lteAnchor), cellsWithNrLeg(listOf(lteAnchor), null))

        val leg = nrSignalStrengthLeg(ssRsrp = -102, ssRsrq = -12, ssSinr = 4)
        assertNull(cellsWithNrLeg(null, leg))
    }

    @Suppress("DEPRECATION") // NR_NSA_MMWAVE is what API 30 reports for mmWave.
    @Test
    fun overrideNetworkTypeWritesMmWaveAsNrAdvanced() {
        assertEquals(
            OverrideNetworkType.NR_ADVANCED,
            overrideNetworkTypeOf(TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA_MMWAVE),
        )
        assertEquals(
            OverrideNetworkType.NR_ADVANCED,
            overrideNetworkTypeOf(TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_ADVANCED),
        )
        assertEquals(
            OverrideNetworkType.NR_NSA,
            overrideNetworkTypeOf(TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA),
        )
        assertNull(overrideNetworkTypeOf(99))

        val sim = simReading(
            slotIndex = 0, simOperator = "00101", operatorNumeric = "00101",
            operatorAlphaLong = null, serviceState = ServiceStatus.IN_SERVICE,
            overrideNetworkType = TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_LTE_CA, cells = null,
        )
        assertEquals(OverrideNetworkType.LTE_CA, sim.overrideNetworkType)
    }
}
