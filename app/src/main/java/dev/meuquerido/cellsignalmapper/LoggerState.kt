package dev.meuquerido.cellsignalmapper

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class PingResult { SUCCESS, DUPLICATE, BAD }

/**
 * What the main screen shows about the logging service. [sampleCount] grows by one per sample so
 * the screen can react to a sample even when it repeats the previous values. [pendingCount] is the
 * number of samples not uploaded yet.
 */
data class LoggerUiState(
    val isLogging: Boolean = false,
    val location: String = "Getting Location...",
    val signalStrength: String = "Getting Signal Strength...",
    val pingResult: PingResult? = null,
    val sampleCount: Int = 0,
    val pendingCount: Int = 0,
) {
    fun serviceStarted(): LoggerUiState = copy(isLogging = true, location = "", signalStrength = "")

    fun serviceStopped(): LoggerUiState = copy(isLogging = false, location = "", signalStrength = "")

    /** Ignores a sample that arrives after the service stopped. */
    fun withSample(lat: Double?, lon: Double?, signalDbm: Int, pingResult: PingResult): LoggerUiState =
        if (!isLogging) {
            this
        } else {
            copy(
                location = "Lat: $lat, Lon: $lon",
                signalStrength = "Signal Strength: $signalDbm dBm",
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

    fun sample(lat: Double?, lon: Double?, signalDbm: Int, pingResult: PingResult) =
        mutableState.update { it.withSample(lat, lon, signalDbm, pingResult) }

    fun pendingCount(count: Int) = mutableState.update { it.copy(pendingCount = count) }
}
