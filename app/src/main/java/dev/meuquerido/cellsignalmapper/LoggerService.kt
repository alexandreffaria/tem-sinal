package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.*
import java.io.File
import java.io.IOException
import java.util.UUID

class LoggerService : Service() {

    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private lateinit var telephonyManager: TelephonyManager
    private lateinit var subscriptionManager: SubscriptionManager

    /** Shared by every sample this service instance logs; a restarted service gets a new one. */
    private val sessionId = UUID.randomUUID().toString()

    private lateinit var locationClient: FusedLocationProviderClient

    /** Written on the main looper by [locationCallback], read by the logging loop. */
    @Volatile
    private var latestLocation: Location? = null

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            latestLocation = result.lastLocation ?: return
        }
    }

    private var lastLat: Double? = null
    private var lastLon: Double? = null
    private var lastSignal: Int? = null

    override fun onBind(intent: Intent?): IBinder? = null

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    override fun onCreate() {
        super.onCreate()
        Log.d("LoggerService", "Service created and starting logging loop")

        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        subscriptionManager = getSystemService(SubscriptionManager::class.java)

        // startForeground comes first: a service started with startForegroundService crashes the
        // app if it stops without calling it. On Android 14+ it throws SecurityException for a
        // location service when no location permission is granted.
        val inForeground = try {
            startForegroundService()
            true
        } catch (e: SecurityException) {
            Log.w("LoggerService", "Location not granted; cannot run in the foreground", e)
            false
        }
        if (!inForeground ||
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w("LoggerService", "Fine location not granted; not logging")
            stopSelf()
            return
        }

        LoggerState.serviceStarted()
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        startLocationUpdates()
        startLoggingLoop()
    }

    private fun startForegroundService() {
        val channelId = "LoggerChannel"
        createNotificationChannel(channelId)

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Signal logging active")
            .setContentText("Tracking location and signal strength")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

        startForeground(1, notification)
    }

    private fun createNotificationChannel(channelId: String) {
        val channel = NotificationChannel(
            channelId,
            "Logger Service",
            NotificationManager.IMPORTANCE_LOW
        )
        (getSystemService(NotificationManager::class.java))
            .createNotificationChannel(channel)
    }

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L)
            .setWaitForAccurateLocation(true)
            .setMaxUpdateDelayMillis(0)
            .build()
        locationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
    }

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLoggingLoop() {
        coroutineScope.launch {
            val installId = try {
                installId(File(noBackupFilesDir, INSTALL_ID_FILE_NAME))
            } catch (e: IOException) {
                Log.e("LoggerService", "Could not store the install id; stopping", e)
                stopSelf()
                return@launch
            }

            while (isActive) {
                val location = latestLocation?.takeIf {
                    isFixFresh(
                        it.elapsedRealtimeNanos / 1_000_000,
                        SystemClock.elapsedRealtime()
                    )
                }
                val lat = location?.latitude
                val lon = location?.longitude

                val registeredCells = try {
                    telephonyManager.allCellInfo.orEmpty()
                        .filter { it.isRegistered }
                        .mapNotNull { it.toCellReading() }
                } catch (e: SecurityException) {
                    Log.e("LoggerService", "Location permission revoked; stopping", e)
                    stopSelf()
                    break
                }
                // allCellInfo holds every SIM's registered cell; keep the default SIM's carrier's.
                val simOperator = telephonyManager.simOperator
                val cells = registeredCells.filter { it.plmn == simOperator }
                if (cells.size < registeredCells.size) {
                    Log.d("LoggerService", "Skipped registered cells not on the SIM's carrier")
                }
                val signalDbm = cells.firstNotNullOfOrNull { it.headlineDbm() }

                val pingResult = when {
                    lat == null || lon == null || signalDbm == null -> PingResult.BAD
                    lastLat == null || lastLon == null -> PingResult.SUCCESS
                    !hasMoved(lat, lon, lastLat!!, lastLon!!, 10f)
                            && signalDbm == lastSignal -> {
                        Log.d("LoggerService", "Skipped — no move AND no signal change")
                        PingResult.DUPLICATE
                    }
                    else -> PingResult.SUCCESS
                }

                if (pingResult == PingResult.SUCCESS && location != null) {
                    lastLat = lat
                    lastLon = lon
                    lastSignal = signalDbm

                    val sample = Sample(
                        schemaVersion = SAMPLE_SCHEMA_VERSION,
                        id = UUID.randomUUID().toString(),
                        installId = installId,
                        sessionId = sessionId,
                        timeMs = System.currentTimeMillis(),
                        elapsedRealtimeMs = SystemClock.elapsedRealtime(),
                        fix = location.toFix(),
                        sims = listOf(simReading(defaultSimSlot(), simOperator, cells)),
                    )
                    SignalLogger.logEntry(this@LoggerService, sample)
                }

                LoggerState.sample(lat, lon, signalDbm, pingResult)

                delay(5000)
            }
        }
    }

    /** The default subscription's SIM slot index, or null when it can't be read. */
    private fun defaultSimSlot(): Int? =
        try {
            subscriptionManager
                .getActiveSubscriptionInfo(SubscriptionManager.getDefaultSubscriptionId())
                ?.simSlotIndex
        } catch (e: SecurityException) {
            null
        }

    private fun Location.toFix(): Fix = Fix(
        lat = roundCoordinate(latitude),
        lon = roundCoordinate(longitude),
        accuracyM = if (hasAccuracy()) accuracy else null,
        altitudeM = if (hasAltitude()) altitude else null,
        verticalAccuracyM = if (hasVerticalAccuracy()) verticalAccuracyMeters else null,
        timeMs = time,
        elapsedRealtimeMs = elapsedRealtimeNanos / 1_000_000,
        mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProviderBelowS(),
    )

    @Suppress("DEPRECATION") // isMock replaces it from API 31.
    private fun Location.isFromMockProviderBelowS(): Boolean = isFromMockProvider

    private fun hasMoved(lat1: Double, lon1: Double, lat2: Double, lon2: Double, thresholdMeters: Float): Boolean {
        val result = FloatArray(1)
        Location.distanceBetween(lat1, lon1, lat2, lon2, result)
        return result[0] > thresholdMeters
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
        START_STICKY

    override fun onDestroy() {
        if (::locationClient.isInitialized) {
            locationClient.removeLocationUpdates(locationCallback)
        }
        coroutineScope.cancel()
        LoggerState.serviceStopped()
        super.onDestroy()
    }
}
