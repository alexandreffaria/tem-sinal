package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices

/** A made-up place for the fused location client to report, from a [MockLocationReceiver] broadcast. */
data class MockPlace(val lat: Double, val lon: Double, val accuracyM: Float)

/**
 * The place a broadcast asks for, or null when [lat] or [lon] is missing or off the globe or
 * [accuracyM] isn't a positive number. A missing [accuracyM] is 5 m, accurate enough to be logged.
 */
fun mockPlace(lat: Double?, lon: Double?, accuracyM: Float?): MockPlace? {
    if (lat == null || lon == null || lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
    val accuracy = accuracyM ?: DEFAULT_MOCK_ACCURACY_M
    if (!(accuracy > 0f) || accuracy.isInfinite()) return null
    return MockPlace(lat, lon, accuracy)
}

private const val DEFAULT_MOCK_ACCURACY_M = 5f

/**
 * Debug builds only: puts the fused location client in mock mode at a made-up place, so that a
 * check on a phone logs samples with `fix.mock` true instead of the phone's own position. While
 * mock mode is on it sets the place again every second with the current time, so the fix stays
 * fresh; it lasts until [ACTION_STOP] or until the app's process ends, and then the real position
 * comes back.
 *
 * ```
 * adb shell appops set dev.meuquerido.temsinal android:mock_location allow
 * adb shell am broadcast -n dev.meuquerido.temsinal/dev.meuquerido.cellsignalmapper.MockLocationReceiver \
 *     -a dev.meuquerido.cellsignalmapper.MOCK_LOCATION --ed lat <lat> --ed lon <lon> [--ef accuracy <m>]
 * adb shell am broadcast -n dev.meuquerido.temsinal/dev.meuquerido.cellsignalmapper.MockLocationReceiver \
 *     -a dev.meuquerido.cellsignalmapper.STOP_MOCK_LOCATION
 * ```
 */
class MockLocationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "Mock mode needs precise location allowed for the app")
            return
        }
        val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
        when (intent.action) {
            ACTION_MOCK -> {
                val place = mockPlace(
                    lat = intent.doubleExtraOrNull(EXTRA_LAT),
                    lon = intent.doubleExtraOrNull(EXTRA_LON),
                    accuracyM = if (intent.hasExtra(EXTRA_ACCURACY)) intent.getFloatExtra(EXTRA_ACCURACY, 0f) else null,
                )
                if (place == null) {
                    Log.e(TAG, "Needs --ed lat and --ed lon on the globe, and --ef accuracy above 0 if given")
                    return
                }
                client.setMockMode(true)
                    .addOnSuccessListener {
                        stopRepeating()
                        repeat = object : Runnable {
                            override fun run() {
                                try {
                                    client.setMockLocation(place.toLocation())
                                        .addOnFailureListener { Log.e(TAG, "setMockLocation failed", it) }
                                } catch (e: SecurityException) {
                                    Log.e(TAG, "Location permission revoked; stopped setting the place", e)
                                    return
                                }
                                handler.postDelayed(this, REPEAT_MS)
                            }
                        }.also { it.run() }
                        Log.i(TAG, "Mock mode on")
                    }
                    .addOnFailureListener { Log.e(TAG, "setMockMode failed; is android:mock_location allowed?", it) }
            }
            ACTION_STOP -> {
                stopRepeating()
                client.setMockMode(false)
                    .addOnSuccessListener { Log.i(TAG, "Mock mode off") }
                    .addOnFailureListener { Log.e(TAG, "setMockMode(false) failed", it) }
            }
        }
    }

    private fun Intent.doubleExtraOrNull(name: String): Double? =
        if (hasExtra(name)) getDoubleExtra(name, Double.NaN) else null

    private fun MockPlace.toLocation(): Location = Location(LocationManager.GPS_PROVIDER).also {
        it.latitude = lat
        it.longitude = lon
        it.accuracy = accuracyM
        it.time = System.currentTimeMillis()
        it.elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
    }

    private companion object {
        const val TAG = "MockLocationReceiver"
        const val ACTION_MOCK = "dev.meuquerido.cellsignalmapper.MOCK_LOCATION"
        const val ACTION_STOP = "dev.meuquerido.cellsignalmapper.STOP_MOCK_LOCATION"
        const val EXTRA_LAT = "lat"
        const val EXTRA_LON = "lon"
        const val EXTRA_ACCURACY = "accuracy"
        const val REPEAT_MS = 1_000L

        val handler = Handler(Looper.getMainLooper())
        /** The task setting the place every second while mock mode is on; one per process. */
        var repeat: Runnable? = null

        fun stopRepeating() {
            repeat?.let(handler::removeCallbacks)
            repeat = null
        }
    }
}
