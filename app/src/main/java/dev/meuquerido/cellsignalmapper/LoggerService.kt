package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.telephony.CellInfo
import android.telephony.CellSignalStrengthNr
import android.telephony.PhoneStateListener
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyCallback
import android.telephony.TelephonyDisplayInfo
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor

/** The subscription ids whose display info listener is to be registered, and to be unregistered. */
data class ListenerChanges(val add: Set<Int>, val remove: Set<Int>)

/** What makes the listeners registered on [registeredIds] exactly one on each of [activeIds]. */
fun listenerChanges(activeIds: Set<Int>, registeredIds: Set<Int>): ListenerChanges =
    ListenerChanges(add = activeIds - registeredIds, remove = registeredIds - activeIds)

/**
 * Puts [value] in [values] for [subscriptionId] only while the registration [ownRegistration]
 * returns is still that subscription's entry in [registrations]; [ownRegistration] is called only
 * when there is an entry. Both are read under the lock on [registrations], so a callback that
 * runs after its registration was removed writes nothing.
 */
fun <T> recordWhileRegistered(
    registrations: Map<Int, T>,
    subscriptionId: Int,
    ownRegistration: () -> T,
    values: MutableMap<Int, Int>,
    value: Int,
) {
    synchronized(registrations) {
        val current = registrations[subscriptionId] ?: return
        if (current === ownRegistration()) values[subscriptionId] = value
    }
}

/**
 * Runs [action] once [job] has completed, which for a cancelled job is after its body has stopped
 * running; straight away when there is no job or it has already completed.
 */
fun afterCompletion(job: Job?, action: () -> Unit) {
    if (job == null) action() else job.invokeOnCompletion { action() }
}

/** The battery percentage at or below which logging stops by itself, charging or not. */
const val LOW_BATTERY_STOP_PERCENT = 10

/**
 * Whether logging stops to keep the battery for calls, from `ACTION_BATTERY_CHANGED`'s [level] out
 * of [scale], whether or not the phone is charging. An unknown level (negative, or a scale of 0 or
 * less) never stops it.
 */
fun stopsForLowBattery(level: Int, scale: Int): Boolean =
    level >= 0 && scale > 0 && level * 100 <= LOW_BATTERY_STOP_PERCENT * scale

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

    /**
     * Holds one element after [locationCallback] delivers a fix, until the logging loop takes it.
     * A delivery wakes the CPU, so ticks started from deliveries keep running with the screen
     * off, where a coroutine `delay` doesn't count the time the CPU sleeps.
     */
    private val fixDeliveries = Channel<Unit>(Channel.CONFLATED)

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            latestLocation = result.lastLocation ?: return
            fixDeliveries.trySend(Unit)
        }
    }

    private lateinit var locationManager: LocationManager

    /**
     * The number of satellites the GNSS engine last reported as used in its fix; 0 while the
     * engine is stopped. Written by [gnssStatusCallback], read by the logging loop.
     */
    @Volatile
    private var satellitesUsed = 0

    private val gnssStatusCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            satellitesUsed = (0 until status.satelliteCount).count { status.usedInFix(it) }
        }

        override fun onStopped() {
            satellitesUsed = 0
        }
    }

    /**
     * The latest `TelephonyDisplayInfo.getOverrideNetworkType()` per subscription id, written by
     * the listeners in [displayInfoListeners].
     */
    private val overrideNetworkTypes = ConcurrentHashMap<Int, Int>()

    /**
     * What unregisters each active subscription's display info listener, by subscription id.
     * Guarded by itself, like [destroyed], so no listener is registered after [onDestroy]
     * unregistered them.
     */
    private val displayInfoListeners = HashMap<Int, () -> Unit>()
    private var destroyed = false

    /** The logging loop; null when [onCreate] stopped before starting it. */
    private var loggingJob: Job? = null

    /**
     * Stops the service the way STOP does when the phone shuts down or the battery gets low, so
     * the session ends with its samples kept and an upload scheduled. Runs on the main thread.
     */
    private val powerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SHUTDOWN -> {
                    Log.i("LoggerService", "Phone shutting down; stopping")
                    stopSelf()
                }
                Intent.ACTION_BATTERY_CHANGED -> if (!stoppedForLowBattery && stopsForLowBattery(
                        level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                        scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
                    )
                ) {
                    stoppedForLowBattery = true
                    Log.i("LoggerService", "Battery low; stopping")
                    notifyLowBatteryStop()
                    stopSelf()
                }
            }
        }
    }
    private var powerReceiverRegistered = false
    private var stoppedForLowBattery = false

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

        LoggerState.serviceStarted(sessionId)
        // A low-battery notice from an earlier session is stale once logging runs again.
        getSystemService(NotificationManager::class.java).cancel(LOW_BATTERY_NOTIFICATION_ID)
        // ACTION_BATTERY_CHANGED is sticky: the receiver gets the current level straight away, so
        // a start on a low battery stops at once.
        ContextCompat.registerReceiver(
            this,
            powerReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SHUTDOWN)
                addAction(Intent.ACTION_BATTERY_CHANGED)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        powerReceiverRegistered = true
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        startLocationUpdates()
        locationManager = getSystemService(LocationManager::class.java)
        locationManager.registerGnssStatusCallback(Executor(Runnable::run), gnssStatusCallback)
        startLoggingLoop()
    }

    private fun startForegroundService() {
        createNotificationChannel(CHANNEL_ID)

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

        startForeground(1, notification)
    }

    /** Tells the user that logging stopped by itself to keep the battery for calls. */
    private fun notifyLowBatteryStop() {
        val text = getString(R.string.low_battery_stop_text)
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.low_battery_stop_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_lock_idle_low_battery)
            .build()
        getSystemService(NotificationManager::class.java).notify(LOW_BATTERY_NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel(channelId: String) {
        val channel = NotificationChannel(
            channelId,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW
        )
        (getSystemService(NotificationManager::class.java))
            .createNotificationChannel(channel)
    }

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, TICK_INTERVAL_MS)
            .setMinUpdateIntervalMillis(TICK_INTERVAL_MS)
            .setWaitForAccurateLocation(true)
            .setMaxUpdateDelayMillis(0)
            .build()
        locationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
    }

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLoggingLoop() {
        loggingJob = coroutineScope.launch {
            val installId = try {
                installId(File(noBackupFilesDir, INSTALL_ID_FILE_NAME))
            } catch (e: IOException) {
                Log.e("LoggerService", "Could not store the install id; stopping", e)
                stopSelf()
                return@launch
            }

            // The session's first ticks, for startLooksIndoor.
            val startTicks = mutableListOf<StartTick>()
            // When the previous tick started; null before the first tick, which starts at once.
            var previousStartMs: Long? = null
            while (isActive) {
                // Waits for a delivered fix, or for longer without one: a tick without a fix still
                // shows each SIM's state and counts for startLooksIndoor.
                var fixDelivered = false
                while (previousStartMs != null) {
                    if (fixDeliveries.tryReceive().isSuccess) fixDelivered = true
                    val waitMs = msUntilNextTick(previousStartMs, fixDelivered, SystemClock.elapsedRealtime())
                    if (waitMs == 0L) break
                    withTimeoutOrNull(waitMs) {
                        fixDeliveries.receive()
                        fixDelivered = true
                    }
                }
                previousStartMs = SystemClock.elapsedRealtime()
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
                val pingResult = if (sample != null) {
                    SignalLogger.logEntry(this@LoggerService, sample)
                    PingResult.SUCCESS
                } else {
                    PingResult.BAD
                }

                LoggerState.sample(location?.latitude, location?.longitude, sims, pingResult)
                // Advice only: the hint is decided after the tick's sample was written and changes
                // nothing that is logged.
                if (startTicks.size < START_TICKS) {
                    startTicks += StartTick(
                        accuracyM = location?.takeIf { it.hasAccuracy() }?.accuracy,
                        satellitesUsed = satellitesUsed,
                    )
                    if (startLooksIndoor(startTicks)) LoggerState.indoorHint()
                }
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
        listenForDisplayInfo(subscriptions.map { it.subscriptionId }.toSet())
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
        val nrStrength = manager.signalStrength
            ?.getCellSignalStrengths(CellSignalStrengthNr::class.java)?.firstOrNull()
        val nrLeg = nrStrength?.let { nrSignalStrengthLeg(it.ssRsrp, it.ssRsrq, it.ssSinr) }
        return simReading(
            slotIndex = subscription.simSlotIndex,
            simOperator = manager.simOperator,
            operatorNumeric = serviceState?.operatorNumeric,
            operatorAlphaLong = serviceState?.operatorAlphaLong,
            serviceState = serviceState?.toServiceStatus(
                airplaneModeOn = Settings.Global.getInt(
                    contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0,
                ) != 0,
            ),
            overrideNetworkType = overrideNetworkTypes[subscription.subscriptionId],
            cells = cellsWithNrLeg(cells?.mapNotNull { it.toCellReading() }, nrLeg),
        )
    }

    /**
     * Keeps one display info listener on each of [activeIds], which keeps [overrideNetworkTypes]
     * up to date for it; unregisters the listener and drops the value of every other subscription.
     */
    private fun listenForDisplayInfo(activeIds: Set<Int>) {
        synchronized(displayInfoListeners) {
            if (destroyed) return
            val changes = listenerChanges(activeIds, displayInfoListeners.keys)
            changes.remove.forEach { subscriptionId ->
                displayInfoListeners.remove(subscriptionId)?.invoke()
                overrideNetworkTypes.remove(subscriptionId)
            }
            changes.add.forEach { subscriptionId ->
                val manager = telephonyManager.createForSubscriptionId(subscriptionId)
                // Set before this block releases the lock that record reads it under.
                lateinit var unregister: () -> Unit
                val record = { info: TelephonyDisplayInfo ->
                    recordWhileRegistered(
                        displayInfoListeners,
                        subscriptionId,
                        { unregister },
                        overrideNetworkTypes,
                        info.overrideNetworkType,
                    )
                }
                unregister =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        listenForDisplayInfoFromS(manager, record)
                    } else {
                        listenForDisplayInfoBelowS(manager, record)
                    }
                displayInfoListeners[subscriptionId] = unregister
            }
        }
    }

    /** Registers a display info callback on [manager]; returns what unregisters it. */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun listenForDisplayInfoFromS(
        manager: TelephonyManager,
        record: (TelephonyDisplayInfo) -> Unit,
    ): () -> Unit {
        val callback = object : TelephonyCallback(), TelephonyCallback.DisplayInfoListener {
            override fun onDisplayInfoChanged(telephonyDisplayInfo: TelephonyDisplayInfo) =
                record(telephonyDisplayInfo)
        }
        manager.registerTelephonyCallback(Executor(Runnable::run), callback)
        return { manager.unregisterTelephonyCallback(callback) }
    }

    /**
     * Registers a display info listener on [manager], which needs `READ_PHONE_STATE` on API 30;
     * returns what unregisters it.
     */
    @Suppress("DEPRECATION") // TelephonyCallback replaces PhoneStateListener from API 31.
    private fun listenForDisplayInfoBelowS(
        manager: TelephonyManager,
        record: (TelephonyDisplayInfo) -> Unit,
    ): () -> Unit {
        val listener = object : PhoneStateListener(Executor(Runnable::run)) {
            override fun onDisplayInfoChanged(telephonyDisplayInfo: TelephonyDisplayInfo) =
                record(telephonyDisplayInfo)
        }
        manager.listen(listener, PhoneStateListener.LISTEN_DISPLAY_INFO_CHANGED)
        return { manager.listen(listener, PhoneStateListener.LISTEN_NONE) }
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

    private companion object {
        /** How long a tick waits for each subscription's modem to report its cells. */
        const val CELL_INFO_TIMEOUT_MS = 3_000L

        const val CHANNEL_ID = "LoggerChannel"

        /** Not the foreground notification's id, so it stays after the service stops. */
        const val LOW_BATTERY_NOTIFICATION_ID = 2
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
        START_STICKY

    override fun onDestroy() {
        if (powerReceiverRegistered) unregisterReceiver(powerReceiver)
        if (::locationClient.isInitialized) {
            locationClient.removeLocationUpdates(locationCallback)
        }
        if (::locationManager.isInitialized) {
            locationManager.unregisterGnssStatusCallback(gnssStatusCallback)
        }
        coroutineScope.cancel()
        synchronized(displayInfoListeners) {
            destroyed = true
            displayInfoListeners.values.forEach { it() }
            displayInfoListeners.clear()
        }
        LoggerState.serviceStopped()
        // A tick past its last suspension point still writes its sample after the cancel, so the
        // stop upload waits for the loop to finish to include it.
        afterCompletion(loggingJob) { UploadWorker.enqueue(applicationContext) }
        super.onDestroy()
    }
}
