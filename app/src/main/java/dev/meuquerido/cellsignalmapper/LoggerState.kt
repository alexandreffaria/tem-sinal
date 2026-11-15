package dev.meuquerido.cellsignalmapper

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

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

/** Each SIM's service state in plain words, one line per SIM, such as "SIM 1: No service". */
fun serviceText(sims: List<SimReading>): List<UiText> =
    if (sims.isEmpty()) {
        listOf(UiText(R.string.no_active_sim))
    } else {
        sims.map { sim ->
            val words = UiText(
                when (sim.serviceState) {
                    ServiceStatus.IN_SERVICE -> R.string.in_service
                    ServiceStatus.EMERGENCY_ONLY -> R.string.emergency_calls_only
                    ServiceStatus.OUT_OF_SERVICE -> R.string.no_service
                    ServiceStatus.POWER_OFF -> R.string.no_service_radio_off
                    null -> R.string.service_unknown
                },
            )
            sim.slot?.let { UiText(R.string.sim_slot_service, listOf(it + 1, words)) }
                ?: UiText(R.string.sim_service, listOf(words))
        }
    }

/**
 * What the main screen shows about the logging service. [sampleCount] grows by one per sample so
 * the screen can react to a sample even when it repeats the previous values. [pendingCount] is the
 * number of samples not uploaded yet.
 */
data class LoggerUiState(
    val isLogging: Boolean = false,
    /** The last tick's position; null shows nothing. */
    val location: UiText? = UiText(R.string.getting_location),
    /** The last tick's signal strength; null shows nothing. */
    val signalStrength: UiText? = UiText(R.string.getting_signal_strength),
    /** [serviceText] of the last tick's SIMs. */
    val service: List<UiText> = emptyList(),
    val pingResult: PingResult? = null,
    val sampleCount: Int = 0,
    val pendingCount: Int = 0,
    /** Advice shown below the button, such as [R.string.indoor_hint]; null shows nothing. */
    val hint: UiText? = null,
) {
    fun serviceStarted(): LoggerUiState =
        copy(isLogging = true, location = null, signalStrength = null, service = emptyList())

    fun serviceStopped(): LoggerUiState =
        copy(isLogging = false, location = null, signalStrength = null, service = emptyList(), hint = null)

    /**
     * Suggests logging on the trail, after a start that [startLooksIndoor]. Ignored after the
     * service stopped, so a session's hint never outlives it.
     */
    fun withIndoorHint(): LoggerUiState =
        if (isLogging) copy(hint = UiText(R.string.indoor_hint)) else this

    /**
     * Shows a tick's position (null when it had no fresh fix), the headline strength of the first
     * registered cell with one, and each SIM's service state. Ignores a tick that arrives after
     * the service stopped.
     */
    fun withSample(
        lat: Double?,
        lon: Double?,
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
                location = if (lat != null && lon != null) {
                    UiText(R.string.location, listOf(lat.toString(), lon.toString()))
                } else {
                    UiText(R.string.no_location_fix)
                },
                signalStrength = signalDbm?.let { UiText(R.string.signal_strength_dbm, listOf(it)) }
                    ?: UiText(R.string.signal_strength_unknown),
                service = serviceText(sims),
                pingResult = pingResult,
                sampleCount = sampleCount + 1,
            )
        }
}

/** Process-wide state written by [LoggerService] and [SignalLogger] and read by the activity. */
object LoggerState {
    private val mutableState = MutableStateFlow(LoggerUiState())
    val state: StateFlow<LoggerUiState> = mutableState.asStateFlow()

    fun serviceStarted() = mutableState.update { it.serviceStarted() }

    fun serviceStopped() = mutableState.update { it.serviceStopped() }

    fun sample(lat: Double?, lon: Double?, sims: List<SimReading>, pingResult: PingResult) =
        mutableState.update { it.withSample(lat, lon, sims, pingResult) }

    fun pendingCount(count: Int) = mutableState.update { it.copy(pendingCount = count) }

    fun indoorHint() = mutableState.update { it.withIndoorHint() }

    fun dismissHint() = mutableState.update { it.copy(hint = null) }
}
