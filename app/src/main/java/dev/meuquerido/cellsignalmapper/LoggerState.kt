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
fun serviceText(sims: List<SimReading>): String =
    if (sims.isEmpty()) {
        "No active SIM"
    } else {
        sims.joinToString("\n") { sim ->
            val name = sim.slot?.let { "SIM ${it + 1}" } ?: "SIM"
            val words = when (sim.serviceState) {
                ServiceStatus.IN_SERVICE -> "In service"
                ServiceStatus.EMERGENCY_ONLY -> "Emergency calls only"
                ServiceStatus.OUT_OF_SERVICE -> "No service"
                ServiceStatus.POWER_OFF -> "No service (radio off)"
                null -> "Service unknown"
            }
            "$name: $words"
        }
    }

/**
 * What the main screen shows about the logging service. [sampleCount] grows by one per sample so
 * the screen can react to a sample even when it repeats the previous values. [pendingCount] is the
 * number of samples not uploaded yet.
 */
data class LoggerUiState(
    val isLogging: Boolean = false,
    val location: String = "Getting Location...",
    val signalStrength: String = "Getting Signal Strength...",
    /** [serviceText] of the last tick's SIMs. */
    val service: String = "",
    val pingResult: PingResult? = null,
    val sampleCount: Int = 0,
    val pendingCount: Int = 0,
) {
    fun serviceStarted(): LoggerUiState =
        copy(isLogging = true, location = "", signalStrength = "", service = "")

    fun serviceStopped(): LoggerUiState =
        copy(isLogging = false, location = "", signalStrength = "", service = "")

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
                location = "Lat: $lat, Lon: $lon",
                signalStrength = "Signal Strength: ${signalDbm?.let { "$it dBm" } ?: "unknown"}",
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
