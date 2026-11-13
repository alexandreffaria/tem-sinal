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
import android.telephony.CellInfo
import android.telephony.SubscriptionInfo
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
import java.util.concurrent.Executor

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

    /** The last sample logged, which the next tick's sample is compared with. */
    private var lastSample: Sample? = null

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
        // Without phone state access there are no active subscriptions, so no sample can be written.
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            Log.w("LoggerService", "Phone state not granted; not logging")
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

                val sims = try {
                    readSims()
                } catch (e: SecurityException) {
                    Log.e("LoggerService", "Location permission revoked; stopping", e)
                    stopSelf()
                    break
                }
                // A tick with a fix and no signal still gives a sample: no signal is what the map
                // is for.
                val sample = location?.let {
                    sample(
                        installId = installId,
                        sessionId = sessionId,
                        timeMs = System.currentTimeMillis(),
                        elapsedRealtimeMs = SystemClock.elapsedRealtime(),
                        fix = it.toFix(),
                        sims = sims,
                    )
                }
                val pingResult = tickResult(sample, lastSample, ::distanceM)
                if (sample != null && pingResult == PingResult.SUCCESS) {
                    lastSample = sample
                    SignalLogger.logEntry(this@LoggerService, sample)
                } else if (pingResult == PingResult.DUPLICATE) {
                    Log.d("LoggerService", "Skipped: not moved and nothing changed")
                }

                LoggerState.sample(location?.latitude, location?.longitude, sims, pingResult)

                delay(5000)
            }
        }
    }

    /**
     * One reading per active subscription, read at the same time; empty when there is none or
     * phone state access isn't granted. Throws [SecurityException] without fine location.
     */
    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private suspend fun readSims(): List<SimReading> {
        val subscriptions = try {
            subscriptionManager.activeSubscriptionInfoList.orEmpty()
        } catch (e: SecurityException) {
            return emptyList()
        }
        return kotlinx.coroutines.coroutineScope {
            subscriptions.map { async { readSim(it) } }.awaitAll()
        }
    }

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private suspend fun readSim(subscription: SubscriptionInfo): SimReading {
        val manager = telephonyManager.createForSubscriptionId(subscription.subscriptionId)
        val serviceState = try {
            manager.serviceState
        } catch (e: SecurityException) {
            null
        }
        val cells = awaitCallback<List<CellInfo>>(CELL_INFO_TIMEOUT_MS) { callback ->
            // The subscription can go inactive after it was listed (IllegalArgumentException) and
            // the telephony service can be unavailable (IllegalStateException); either leaves this
            // SIM's cells unknown for the tick. SecurityException propagates.
            try {
                manager.requestCellInfoUpdate(
                    Executor(Runnable::run),
                    object : TelephonyManager.CellInfoCallback() {
                        override fun onCellInfo(cellInfo: List<CellInfo>) = callback(cellInfo)
                        override fun onError(errorCode: Int, detail: Throwable?) = callback(null)
                    },
                )
            } catch (e: IllegalArgumentException) {
                Log.w("LoggerService", "Subscription went inactive; no cells this tick", e)
                callback(null)
            } catch (e: IllegalStateException) {
                Log.w("LoggerService", "Telephony service unavailable; no cells this tick", e)
                callback(null)
            }
        }
        return simReading(
            slotIndex = subscription.simSlotIndex,
            simOperator = manager.simOperator,
            operatorNumeric = serviceState?.operatorNumeric,
            operatorAlphaLong = serviceState?.operatorAlphaLong,
            serviceState = serviceState?.toServiceStatus(),
            cells = cells?.mapNotNull { it.toCellReading() },
        )
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

    private fun distanceM(a: Fix, b: Fix): Float {
        val result = FloatArray(1)
        Location.distanceBetween(a.lat, a.lon, b.lat, b.lon, result)
        return result[0]
    }

    private companion object {
        /** How long a tick waits for each subscription's modem to report its cells. */
        const val CELL_INFO_TIMEOUT_MS = 3_000L
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
