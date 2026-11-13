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

/** How often, in milliseconds, a logging tick starts. */
const val TICK_INTERVAL_MS = 5_000L

/**
 * How long to wait after a tick that started at [tickStartMs] and ended at [nowMs] so the next
 * tick starts [TICK_INTERVAL_MS] after it started; 0 when the tick took longer than that. Both
 * times are on the elapsed-realtime clock, which never jumps.
 */
fun delayUntilNextTickMs(tickStartMs: Long, nowMs: Long): Long =
    (TICK_INTERVAL_MS - (nowMs - tickStartMs)).coerceAtLeast(0L)

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
) {
    fun serviceStarted(): LoggerUiState =
        copy(isLogging = true, location = null, signalStrength = null, service = emptyList())

    fun serviceStopped(): LoggerUiState =
        copy(isLogging = false, location = null, signalStrength = null, service = emptyList())

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
                location = UiText(R.string.location, listOf(lat.toString(), lon.toString())),
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
}
