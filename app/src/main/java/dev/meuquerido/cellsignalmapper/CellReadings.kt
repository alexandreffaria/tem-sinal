package dev.meuquerido.cellsignalmapper

import android.os.Build
import android.telephony.AccessNetworkConstants
import android.telephony.CellIdentityNr
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellSignalStrengthNr
import android.telephony.NetworkRegistrationInfo
import android.telephony.ServiceState
import android.telephony.TelephonyManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

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
 * unknown, [simOperator] is empty while the SIM isn't ready, and [operatorNumeric] and
 * [operatorAlphaLong] are the subscription's `ServiceState` values, null or empty when it isn't
 * registered.
 */
fun simReading(
    slotIndex: Int?,
    simOperator: String?,
    operatorNumeric: String?,
    operatorAlphaLong: String?,
    serviceState: ServiceStatus?,
    cells: List<CellReading>?,
): SimReading =
    SimReading(
        slot = slotIndex?.takeIf { it >= 0 },
        simPlmn = simOperator?.ifEmpty { null },
        registeredPlmn = operatorNumeric?.ifEmpty { null },
        operatorName = operatorAlphaLong?.ifEmpty { null },
        serviceState = serviceState,
        overrideNetworkType = null,
        cells = cells,
    )

/** What [serviceStatus] reads from one `NetworkRegistrationInfo` of a `ServiceState`. */
data class NetworkRegistration(
    /** `getTransportType()`: `AccessNetworkConstants.TRANSPORT_TYPE_WWAN` for cellular. */
    val transportType: Int,
    /** `getAccessNetworkTechnology()`, a `TelephonyManager.NETWORK_TYPE_*` value. */
    val accessNetworkTechnology: Int,
    /** Registered on its home or a roaming network. */
    val registered: Boolean,
    /** `getAvailableServices()`, `NetworkRegistrationInfo.SERVICE_TYPE_*` values. */
    val availableServices: List<Int>,
)

/**
 * The service state of a subscription by the rule in `docs/sample-schema.md`, from its
 * `ServiceState.getState()` [state], its [registrations] and whether airplane mode is on
 * ([airplaneModeOn]). Cellular service is decided from the cellular registrations
 * (`TRANSPORT_TYPE_WWAN` on a technology other than `NETWORK_TYPE_IWLAN`, which legacy-mode IWLAN
 * reports Wi-Fi calling as), because Android raises [state] to `STATE_IN_SERVICE` when voice can go over
 * Wi-Fi calling, also with the radio off; [state] counts as in service only when [registrations]
 * has no cellular entry at all, and airplane mode counts as radio off unless a cellular network is
 * registered. A registered cellular network counts as [ServiceStatus.IN_SERVICE] even when
 * voice isn't, as on a data-only registration. Android reports emergency-only as
 * `STATE_OUT_OF_SERVICE`, so a cellular registration that offers `SERVICE_TYPE_EMERGENCY` counts
 * as [ServiceStatus.EMERGENCY_ONLY].
 */
fun serviceStatus(
    state: Int,
    registrations: List<NetworkRegistration>,
    airplaneModeOn: Boolean,
): ServiceStatus {
    val cellular = registrations.filter {
        it.transportType == AccessNetworkConstants.TRANSPORT_TYPE_WWAN &&
            it.accessNetworkTechnology != TelephonyManager.NETWORK_TYPE_IWLAN
    }
    val registered = cellular.any { it.registered }
    val emergency = NetworkRegistrationInfo.SERVICE_TYPE_EMERGENCY
    return when {
        state == ServiceState.STATE_POWER_OFF || (airplaneModeOn && !registered) ->
            ServiceStatus.POWER_OFF
        registered || (cellular.isEmpty() && state == ServiceState.STATE_IN_SERVICE) ->
            ServiceStatus.IN_SERVICE
        state == ServiceState.STATE_EMERGENCY_ONLY ||
            cellular.any { emergency in it.availableServices } -> ServiceStatus.EMERGENCY_ONLY
        else -> ServiceStatus.OUT_OF_SERVICE
    }
}

/** This subscription's [ServiceStatus], by [serviceStatus]. */
fun ServiceState.toServiceStatus(airplaneModeOn: Boolean): ServiceStatus = serviceStatus(
    state, networkRegistrationInfoList.map { it.toNetworkRegistration() }, airplaneModeOn,
)

private fun NetworkRegistrationInfo.toNetworkRegistration() = NetworkRegistration(
    transportType = transportType,
    accessNetworkTechnology = accessNetworkTechnology,
    registered = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        isNetworkRegistered
    } else {
        isRegisteredBelowU()
    },
    availableServices = availableServices,
)

@Suppress("DEPRECATION") // isNetworkRegistered replaces it from API 34.
private fun NetworkRegistrationInfo.isRegisteredBelowU(): Boolean = isRegistered

/**
 * The value [request] passes to its callback within [timeoutMs], or null when it passes null or
 * doesn't call back in time, so a modem that never answers can't hold up a tick. A callback that
 * comes after the timeout is ignored. [request] calls its callback at most once.
 */
suspend fun <T : Any> awaitCallback(timeoutMs: Long, request: (callback: (T?) -> Unit) -> Unit): T? =
    withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine<T?> { continuation ->
            request { value -> if (continuation.isActive) continuation.resume(value) }
        }
    }

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
