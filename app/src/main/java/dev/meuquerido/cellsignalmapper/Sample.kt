package dev.meuquerido.cellsignalmapper

import java.util.UUID

/** The [Sample.schemaVersion] of every sample this app writes. */
const val SAMPLE_SCHEMA_VERSION = 2

/**
 * One logging tick: where the phone was and what each active subscription saw, as described in
 * `docs/sample-schema.md`. Property names are the wire names in the log file, in JSON and in
 * Firestore, so renaming one is a schema change. A value Android reports as unavailable is null,
 * never a sentinel.
 */
data class Sample(
    val schemaVersion: Int,
    /** A random (version 4) UUID, new for every sample. */
    val id: String,
    /** A random UUID made once per installation and never rotated. */
    val installId: String,
    /** A random UUID made when the logging service starts. */
    val sessionId: String,
    /** Wall-clock time the sample was built, ms since the Unix epoch. */
    val timeMs: Long,
    /** Time since boot when the sample was built, ms; orders samples within a session. */
    val elapsedRealtimeMs: Long,
    val fix: Fix,
    /** One per active subscription; never empty. */
    val sims: List<SimReading>,
)

/**
 * A new [Sample] with a random id, or null when [sims] is empty: every carrier fact is tied to a
 * subscription, so a tick with no active subscription has nothing to record.
 */
fun sample(
    installId: String,
    sessionId: String,
    timeMs: Long,
    elapsedRealtimeMs: Long,
    fix: Fix,
    sims: List<SimReading>,
): Sample? =
    if (sims.isEmpty()) {
        null
    } else {
        Sample(
            schemaVersion = SAMPLE_SCHEMA_VERSION,
            id = UUID.randomUUID().toString(),
            installId = installId,
            sessionId = sessionId,
            timeMs = timeMs,
            elapsedRealtimeMs = elapsedRealtimeMs,
            fix = fix,
            sims = sims,
        )
    }

/** The location fix a sample was taken at. */
data class Fix(
    /** Degrees, WGS84, rounded to 5 decimal places. */
    val lat: Double,
    val lon: Double,
    /** Horizontal accuracy in metres at 68 % confidence. */
    val accuracyM: Float?,
    /** Metres above the WGS84 ellipsoid, not above sea level. */
    val altitudeM: Double?,
    /** Vertical accuracy in metres at 68 % confidence. */
    val verticalAccuracyM: Float?,
    /** The fix's time, ms since the Unix epoch; may come from the phone's clock, which can jump. */
    val timeMs: Long,
    /** The fix's time since boot, ms. */
    val elapsedRealtimeMs: Long,
    /** True when the fix came from a mock location provider. */
    val mock: Boolean,
)

/** What one active subscription saw. */
data class SimReading(
    /** 0-based SIM slot. */
    val slot: Int?,
    /** MCC + MNC of the SIM's own carrier. */
    val simPlmn: String?,
    /** MCC + MNC of the network the subscription is registered on. */
    val registeredPlmn: String?,
    /** The registered network's long name. */
    val operatorName: String?,
    val serviceState: ServiceStatus?,
    val overrideNetworkType: OverrideNetworkType?,
    /** Every cell the modem reported; empty when it saw none, null when it didn't answer. */
    val cells: List<CellReading>?,
)

enum class ServiceStatus { IN_SERVICE, EMERGENCY_ONLY, OUT_OF_SERVICE, POWER_OFF }

/** `TelephonyDisplayInfo` override network types; `NR_NSA_MMWAVE` is written as [NR_ADVANCED]. */
enum class OverrideNetworkType { NONE, LTE_CA, LTE_ADVANCED_PRO, NR_NSA, NR_ADVANCED }

/**
 * One cell. Identity fields use one name for every technology: [arfcn] is the ARFCN, UARFCN,
 * EARFCN or NR-ARFCN; [pci] is the BSIC, PSC or PCI; [ci] is the CID, CI or NCI; [tac] is the LAC
 * or TAC.
 */
data class CellReading(
    val source: CellSource,
    val rat: Rat,
    val registered: Boolean,
    val connection: CellConnection?,
    /** When the modem measured the cell, ms since boot; null for [CellSource.SIGNAL_STRENGTH]. */
    val timestampMs: Long?,
    val arfcn: Int?,
    val pci: Int?,
    /** MCC + MNC, when the cell reports both. */
    val plmn: String?,
    val ci: Long?,
    val tac: Int?,
    /** LTE RSRP or NR SS-RSRP, dBm. */
    val rsrp: Int?,
    /** LTE RSRQ or NR SS-RSRQ, dB. */
    val rsrq: Int?,
    /** LTE RSSNR or NR SS-SINR, dB. */
    val sinr: Int?,
    /** GSM or LTE RSSI, dBm. */
    val rssi: Int?,
    /** WCDMA RSCP, dBm. */
    val rscp: Int?,
    /** WCDMA Ec/No, dB. */
    val ecno: Int?,
)

/** Where a [CellReading] came from. */
enum class CellSource {
    /** A `CellInfo` from `requestCellInfoUpdate`. */
    CELL_INFO,

    /** The NR leg of 5G NSA, known only from `SignalStrength`, with no identity. */
    SIGNAL_STRENGTH,
}

enum class Rat { GSM, WCDMA, LTE, NR }

enum class CellConnection { PRIMARY_SERVING, SECONDARY_SERVING, NONE }
