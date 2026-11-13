package dev.meuquerido.cellsignalmapper

import android.telephony.CellIdentityNr
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrengthNr

/**
 * The valid range of each raw value for one technology, from the CellReading table in
 * `docs/sample-schema.md`. An empty range means the technology doesn't report that value.
 */
private class CellRanges(
    val arfcn: IntRange,
    val pci: IntRange,
    val ci: LongRange,
    val tac: IntRange,
    val rsrp: IntRange = IntRange.EMPTY,
    val rsrq: IntRange = IntRange.EMPTY,
    val sinr: IntRange = IntRange.EMPTY,
    val rssi: IntRange = IntRange.EMPTY,
    val rscp: IntRange = IntRange.EMPTY,
    val ecno: IntRange = IntRange.EMPTY,
)

private val GSM_RANGES = CellRanges(
    arfcn = 0..65535, pci = 0..63, ci = 0L..65535L, tac = 0..65535, rssi = -113..-51,
)
private val WCDMA_RANGES = CellRanges(
    arfcn = 0..65535, pci = 0..511, ci = 0L..268435455L, tac = 0..65535,
    rscp = -120..-24, ecno = -24..1,
)
private val LTE_RANGES = CellRanges(
    arfcn = 0..262143, pci = 0..503, ci = 0L..268435455L, tac = 0..65535,
    rsrp = -140..-43, rsrq = -34..3, sinr = -20..30, rssi = -113..-51,
)
private val NR_RANGES = CellRanges(
    arfcn = 0..3279165, pci = 0..1007, ci = 0L..68719476735L, tac = 0..16777215,
    rsrp = -156..-31, rsrq = -43..20, sinr = -23..40,
)

private fun rangesOf(rat: Rat): CellRanges = when (rat) {
    Rat.GSM -> GSM_RANGES
    Rat.WCDMA -> WCDMA_RANGES
    Rat.LTE -> LTE_RANGES
    Rat.NR -> NR_RANGES
}

private fun Int?.within(range: IntRange): Int? = this?.takeIf { it in range }

private fun Long.within(range: LongRange): Long? = takeIf { it in range }

/** `CellInfo.getCellConnectionStatus()` as a [CellConnection]; null for `CONNECTION_UNKNOWN`. */
fun cellConnection(status: Int): CellConnection? = when (status) {
    CellInfo.CONNECTION_PRIMARY_SERVING -> CellConnection.PRIMARY_SERVING
    CellInfo.CONNECTION_SECONDARY_SERVING -> CellConnection.SECONDARY_SERVING
    CellInfo.CONNECTION_NONE -> CellConnection.NONE
    else -> null
}

/** MCC + MNC, or null when either is null or empty. */
fun plmnOf(mcc: String?, mnc: String?): String? =
    if (mcc.isNullOrEmpty() || mnc.isNullOrEmpty()) null else mcc + mnc

/**
 * A [CellSource.CELL_INFO] reading from the raw values Android reports for a [rat] cell. Every
 * value outside that technology's range is null, which covers `CellInfo.UNAVAILABLE`,
 * `CellInfo.UNAVAILABLE_LONG` and values the technology doesn't report. A strength the
 * technology doesn't have is left out (null).
 */
fun cellReading(
    rat: Rat,
    registered: Boolean,
    connectionStatus: Int,
    timestampMs: Long,
    arfcn: Int,
    pci: Int,
    mcc: String?,
    mnc: String?,
    ci: Long,
    tac: Int,
    rsrp: Int? = null,
    rsrq: Int? = null,
    sinr: Int? = null,
    rssi: Int? = null,
    rscp: Int? = null,
    ecno: Int? = null,
): CellReading {
    val ranges = rangesOf(rat)
    return CellReading(
        source = CellSource.CELL_INFO,
        rat = rat,
        registered = registered,
        connection = cellConnection(connectionStatus),
        timestampMs = timestampMs,
        arfcn = arfcn.within(ranges.arfcn),
        pci = pci.within(ranges.pci),
        plmn = plmnOf(mcc, mnc),
        ci = ci.within(ranges.ci),
        tac = tac.within(ranges.tac),
        rsrp = rsrp.within(ranges.rsrp),
        rsrq = rsrq.within(ranges.rsrq),
        sinr = sinr.within(ranges.sinr),
        rssi = rssi.within(ranges.rssi),
        rscp = rscp.within(ranges.rscp),
        ecno = ecno.within(ranges.ecno),
    )
}

/** The strength the map ranks cells by: RSRP for LTE and NR, RSCP for WCDMA, RSSI for GSM. */
fun CellReading.headlineDbm(): Int? = when (rat) {
    Rat.LTE, Rat.NR -> rsrp
    Rat.WCDMA -> rscp
    Rat.GSM -> rssi
}

/**
 * A [SimReading] from raw values: [slotIndex] is null or negative (`INVALID_SIM_SLOT_INDEX`) when
 * unknown, and [simOperator] is empty while the SIM isn't ready.
 */
fun simReading(slotIndex: Int?, simOperator: String?, cells: List<CellReading>?): SimReading =
    SimReading(
        slot = slotIndex?.takeIf { it >= 0 },
        simPlmn = simOperator?.ifEmpty { null },
        registeredPlmn = null,
        operatorName = null,
        serviceState = null,
        overrideNetworkType = null,
        cells = cells,
    )

/** This cell's identity and its own signal strength, or null for CDMA and TD-SCDMA cells. */
fun CellInfo.toCellReading(): CellReading? = when (this) {
    is CellInfoGsm -> cellReading(
        Rat.GSM, isRegistered, cellConnectionStatus, timestampMillis,
        arfcn = cellIdentity.arfcn, pci = cellIdentity.bsic,
        mcc = cellIdentity.mccString, mnc = cellIdentity.mncString,
        ci = cellIdentity.cid.toLong(), tac = cellIdentity.lac,
        rssi = cellSignalStrength.rssi,
    )
    is CellInfoWcdma -> cellReading(
        Rat.WCDMA, isRegistered, cellConnectionStatus, timestampMillis,
        arfcn = cellIdentity.uarfcn, pci = cellIdentity.psc,
        mcc = cellIdentity.mccString, mnc = cellIdentity.mncString,
        ci = cellIdentity.cid.toLong(), tac = cellIdentity.lac,
        rscp = cellSignalStrength.dbm, ecno = cellSignalStrength.ecNo,
    )
    is CellInfoLte -> cellReading(
        Rat.LTE, isRegistered, cellConnectionStatus, timestampMillis,
        arfcn = cellIdentity.earfcn, pci = cellIdentity.pci,
        mcc = cellIdentity.mccString, mnc = cellIdentity.mncString,
        ci = cellIdentity.ci.toLong(), tac = cellIdentity.tac,
        rsrp = cellSignalStrength.rsrp, rsrq = cellSignalStrength.rsrq,
        sinr = cellSignalStrength.rssnr, rssi = cellSignalStrength.rssi,
    )
    is CellInfoNr -> {
        val identity = cellIdentity as CellIdentityNr
        val strength = cellSignalStrength as CellSignalStrengthNr
        cellReading(
            Rat.NR, isRegistered, cellConnectionStatus, timestampMillis,
            arfcn = identity.nrarfcn, pci = identity.pci,
            mcc = identity.mccString, mnc = identity.mncString,
            ci = identity.nci, tac = identity.tac,
            rsrp = strength.ssRsrp, rsrq = strength.ssRsrq, sinr = strength.ssSinr,
        )
    }
    else -> null
}
