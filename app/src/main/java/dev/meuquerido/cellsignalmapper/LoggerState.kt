package dev.meuquerido.cellsignalmapper

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * What a logging tick did. [SUCCESS]: it logged a sample, with or without signal. [DUPLICATE]: it
 * skipped its sample as a repeat of the last one logged. [BAD]: it had no fresh fix or no active
 * subscription, so it had nothing to log.
 */
enum class PingResult { SUCCESS, DUPLICATE, BAD }

/** How far, in metres, the fix must move from the last sample logged for a tick to be new. */
const val MIN_MOVE_M = 10f

/**
 * The [PingResult] of a tick that built [sample] (null without a fresh fix or an active
 * subscription), given [previous], the last sample logged, and [distanceM] between two fixes.
 * A sample repeats [previous] when the phone moved at most [MIN_MOVE_M] and every SIM has the same
 * service state and the same registered cells at the same headline strength. Comparing service
 * state keeps an emergency-only spot from being skipped as a repeat of an in-service sample at the
 * same place.
 */
fun tickResult(
    sample: Sample?,
    previous: Sample?,
    distanceM: (Fix, Fix) -> Float,
): PingResult = when {
    sample == null -> PingResult.BAD
    previous != null && distanceM(sample.fix, previous.fix) <= MIN_MOVE_M &&
        sample.sims.map { it.coverage() } == previous.sims.map { it.coverage() } ->
        PingResult.DUPLICATE
    else -> PingResult.SUCCESS
}

/** What [tickResult] compares for one SIM. */
private fun SimReading.coverage() = Triple(
    slot,
    serviceState,
    cells?.filter { it.registered }?.map {
        listOf(it.rat, it.arfcn, it.pci, it.plmn, it.ci, it.tac, it.headlineDbm())
    },
)

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
