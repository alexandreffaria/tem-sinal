package dev.meuquerido.cellsignalmapper

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlin.math.roundToInt

/**
 * What a logging tick did. [SUCCESS]: it logged a sample, with or without signal. [BAD]: it had no
 * fresh fix or no active subscription, so it had nothing to log.
 */
enum class PingResult { SUCCESS, BAD }

/** How often, in milliseconds, the location request delivers a fix, each of which starts a tick. */
const val TICK_INTERVAL_MS = 5_000L

/**
 * The least time, in milliseconds, between the starts of two ticks. A little under
 * [TICK_INTERVAL_MS], so a fix delivered slightly early still starts its own tick.
 */
const val MIN_TICK_GAP_MS = 4_500L

/**
 * How long, in milliseconds, after a tick started the next one starts when no fix is delivered.
 * Past [TICK_INTERVAL_MS], so a fix delivered slightly late starts the tick instead of following a
 * no-fix tick by a fraction of a second.
 */
const val NO_FIX_TICK_AFTER_MS = 6_500L

/**
 * How long to wait, from [nowMs], before the next tick, after one that started at [tickStartMs];
 * [fixDelivered] is whether a fix was delivered since it started. With a fix, the next tick
 * starts [MIN_TICK_GAP_MS] after that one started; without, [NO_FIX_TICK_AFTER_MS] after; at once
 * when that has passed. Both times are on the elapsed-realtime clock, which keeps counting while
 * the CPU sleeps.
 */
fun msUntilNextTick(tickStartMs: Long, fixDelivered: Boolean, nowMs: Long): Long =
    ((if (fixDelivered) MIN_TICK_GAP_MS else NO_FIX_TICK_AFTER_MS) - (nowMs - tickStartMs))
        .coerceAtLeast(0L)

/**
 * The signal bars, 0 to 4, of a cell's [headlineDbm]: how many of its technology's thresholds it
 * reaches. The thresholds are Android's defaults, the same the map shades by
 * (`map/public/label.js`). Null when the cell reports no headline strength.
 */
fun CellReading.signalBars(): Int? {
    val dbm = headlineDbm() ?: return null
    val thresholds = when (rat) {
        Rat.LTE -> intArrayOf(-128, -118, -108, -98)
        Rat.NR -> intArrayOf(-110, -90, -80, -65)
        Rat.WCDMA -> intArrayOf(-115, -105, -95, -85)
        Rat.GSM -> intArrayOf(-107, -103, -97, -89)
    }
    return thresholds.count { dbm >= it }
}

/**
 * What a SIM's card on the main screen shows: [label] ("Chip 1 · Vivo"), [value] (the network
 * generation, "SOS" when [emergency], or a dash), and below it [bars] or [detail], the service
 * state in words.
 */
data class SimCard(
    val label: UiText,
    val value: String,
    val emergency: Boolean = false,
    val bars: Int? = null,
    val detail: UiText? = null,
)

/** The value a card shows when there is no network generation to show. */
const val NO_VALUE = "—"

/**
 * [sim]'s card. In service, the value is the generation of its first registered cell (5G for
 * LTE with a 5G NSA or 5G Advanced override) with that cell's bars, or a dash and "In service"
 * without a registered cell or strength. Emergency only is "SOS"; every other state is a dash
 * and its words.
 */
fun simCard(sim: SimReading): SimCard {
    val slotLabel = sim.slot?.let { UiText(R.string.sim_slot, listOf(it + 1)) } ?: UiText(R.string.sim)
    val label = sim.operatorName?.let { UiText(R.string.sim_operator, listOf(slotLabel, it)) } ?: slotLabel
    fun words(id: Int) = SimCard(label, NO_VALUE, detail = UiText(id))
    return when (sim.serviceState) {
        ServiceStatus.IN_SERVICE -> {
            val cell = sim.cells?.firstOrNull { it.registered }
            val value = when (cell?.rat) {
                Rat.GSM -> "2G"
                Rat.WCDMA -> "3G"
                Rat.LTE -> if (sim.overrideNetworkType == OverrideNetworkType.NR_NSA ||
                    sim.overrideNetworkType == OverrideNetworkType.NR_ADVANCED
                ) "5G" else "4G"
                Rat.NR -> "5G"
                null -> NO_VALUE
            }
            val bars = cell?.signalBars()
            SimCard(label, value, bars = bars, detail = if (bars == null) UiText(R.string.in_service) else null)
        }
        ServiceStatus.EMERGENCY_ONLY ->
            SimCard(label, "SOS", emergency = true, detail = UiText(R.string.emergency_calls_only))
        ServiceStatus.OUT_OF_SERVICE -> words(R.string.no_service)
        ServiceStatus.POWER_OFF -> words(R.string.no_service_radio_off)
        null -> words(R.string.service_unknown)
    }
}

/**
 * How long a recording has run, [ms], in whole minutes: "42 min", or "1 h 05 min" from an hour.
 */
fun elapsedText(ms: Long): UiText {
    val minutes = ms.coerceAtLeast(0L) / 60_000L
    return if (minutes < 60) {
        UiText(R.string.elapsed_minutes, listOf(minutes))
    } else {
        UiText(R.string.elapsed_hours, listOf(minutes / 60, minutes % 60))
    }
}

/**
 * What the main screen shows about the logging service. [pendingCount] is the number of samples
 * not uploaded yet.
 */
data class LoggerUiState(
    val isLogging: Boolean = false,
    /** When the recording started, ms since boot (`SystemClock.elapsedRealtime`); null while stopped. */
    val startedAtMs: Long? = null,
    /** The last tick's fix accuracy, or that it had none; null shows nothing. */
    val gps: UiText? = UiText(R.string.getting_location),
    /** The last tick's signal strength; null shows nothing. */
    val signalStrength: UiText? = UiText(R.string.getting_signal_strength),
    /** [simCard] of each of the last tick's SIMs; empty when it had none, null before the first tick. */
    val sims: List<SimCard>? = null,
    val pingResult: PingResult? = null,
    val pendingCount: Int = 0,
    /** Advice shown below the button, such as [R.string.indoor_hint]; null shows nothing. */
    val hint: UiText? = null,
    /** The session id of the recording being logged; null while the service is stopped. */
    val sessionId: String? = null,
) {
    fun serviceStarted(sessionId: String, startedAtMs: Long): LoggerUiState =
        copy(
            isLogging = true,
            startedAtMs = startedAtMs,
            gps = null,
            signalStrength = null,
            sims = null,
            sessionId = sessionId,
        )

    fun serviceStopped(): LoggerUiState =
        copy(
            isLogging = false,
            startedAtMs = null,
            gps = null,
            signalStrength = null,
            sims = null,
            hint = null,
            sessionId = null,
        )

    /**
     * Whether the recording [sessionId] can be deleted: not while it is being logged, since the
     * server would then refuse the rest of it while the phone kept logging it.
     */
    fun canDelete(sessionId: String): Boolean = sessionId != this.sessionId

    /**
     * Suggests logging on the trail, after a start that [startLooksIndoor]. Ignored after the
     * service stopped, so a session's hint never outlives it.
     */
    fun withIndoorHint(): LoggerUiState =
        if (isLogging) copy(hint = UiText(R.string.indoor_hint)) else this

    /**
     * Shows a tick's fix accuracy in metres ([hasFix] false when it had no fresh fix,
     * [accuracyM] null when the fix reported none), the headline strength of the first registered
     * cell with one, and each SIM's [simCard]. Ignores a tick that arrives after the service
     * stopped.
     */
    fun withSample(
        hasFix: Boolean,
        accuracyM: Float?,
        sims: List<SimReading>,
        pingResult: PingResult,
    ): LoggerUiState =
        if (!isLogging) {
            this
        } else {
            val signalDbm = sims.flatMap { it.cells.orEmpty() }
                .filter { it.registered }
                .firstNotNullOfOrNull { it.headlineDbm() }
            copy(
                gps = when {
                    !hasFix -> UiText(R.string.no_location_fix)
                    accuracyM == null -> UiText(R.string.gps)
                    else -> UiText(R.string.gps_accuracy, listOf(accuracyM.roundToInt()))
                },
                signalStrength = signalDbm?.let { UiText(R.string.signal_strength_dbm, listOf(it)) }
                    ?: UiText(R.string.signal_strength_unknown),
                sims = sims.map(::simCard),
                pingResult = pingResult,
            )
        }
}

/** Process-wide state written by [LoggerService] and [SignalLogger] and read by the activity. */
object LoggerState {
    private val mutableState = MutableStateFlow(LoggerUiState())
    val state: StateFlow<LoggerUiState> = mutableState.asStateFlow()

    fun serviceStarted(sessionId: String, startedAtMs: Long) =
        mutableState.update { it.serviceStarted(sessionId, startedAtMs) }

    fun serviceStopped() = mutableState.update { it.serviceStopped() }

    fun sample(hasFix: Boolean, accuracyM: Float?, sims: List<SimReading>, pingResult: PingResult) =
        mutableState.update { it.withSample(hasFix, accuracyM, sims, pingResult) }

    fun pendingCount(count: Int) = mutableState.update { it.copy(pendingCount = count) }

    fun indoorHint() = mutableState.update { it.withIndoorHint() }

    fun dismissHint() = mutableState.update { it.copy(hint = null) }
}
