package dev.meuquerido.cellsignalmapper

import android.telephony.SignalStrength

/** The value logged when no signal strength is known. */
const val UNKNOWN_DBM = -999

/** The GSM ASU value that means unknown. */
private const val UNKNOWN_GSM_ASU = 99

/**
 * The logged signal in dBm: [firstCellDbm] when there is one, else [gsmAsu] converted to dBm,
 * else [UNKNOWN_DBM].
 */
fun loggedDbm(firstCellDbm: Int?, gsmAsu: Int): Int =
    firstCellDbm
        ?: gsmAsu.takeIf { it != UNKNOWN_GSM_ASU }?.let { asu -> -113 + 2 * asu }
        ?: UNKNOWN_DBM

/** The logged signal in dBm for [ss]; see [loggedDbm]. */
@Suppress("DEPRECATION") // gsmSignalStrength is the fallback when no CellSignalStrength is reported.
fun loggedDbm(ss: SignalStrength): Int =
    loggedDbm(ss.cellSignalStrengths.firstOrNull()?.dbm, ss.gsmSignalStrength)
