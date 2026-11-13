package dev.meuquerido.cellsignalmapper

import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellIdentityWcdma

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.telephony.PhoneStateListener
import android.telephony.SignalStrength
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.*
import java.util.UUID

class LoggerService : Service() {

    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private lateinit var telephonyManager: TelephonyManager

    @Volatile
    private var currentDbm: Int = UNKNOWN_DBM

    /** Stops the signal-strength listener started in [onCreate]. */
    private var stopSignalListener: (() -> Unit)? = null

    private var lastLat: Double? = null
    private var lastLon: Double? = null
    private var lastSignal: Int? = null

    override fun onBind(intent: Intent?): IBinder? = null

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    override fun onCreate() {
        super.onCreate()
        Log.d("LoggerService", "Service created and starting logging loop")

        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager

        stopSignalListener = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listenWithTelephonyCallback()
        } else {
            listenWithPhoneStateListener()
        }

        startForegroundService()
        LoggerState.serviceStarted()
        startLoggingLoop()
    }

    private fun onSignalStrength(ss: SignalStrength) {
        val dbm = loggedDbm(ss)
        currentDbm = dbm
        Log.d("LoggerService", "Real-time dBm = $dbm")
    }

    /** Listens on the main thread; returns the function that stops listening. */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun listenWithTelephonyCallback(): () -> Unit {
        val callback = object : TelephonyCallback(), TelephonyCallback.SignalStrengthsListener {
            override fun onSignalStrengthsChanged(ss: SignalStrength) = onSignalStrength(ss)
        }
        telephonyManager.registerTelephonyCallback(mainExecutor, callback)
        return { telephonyManager.unregisterTelephonyCallback(callback) }
    }

    /**
     * Listens on the main thread below API 31, where [TelephonyCallback] doesn't exist;
     * returns the function that stops listening.
     */
    @Suppress("DEPRECATION") // PhoneStateListener is the only signal listener below API 31.
    private fun listenWithPhoneStateListener(): () -> Unit {
        val listener = object : PhoneStateListener(mainExecutor) {
            override fun onSignalStrengthsChanged(ss: SignalStrength) = onSignalStrength(ss)
        }
        telephonyManager.listen(listener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS)
        return { telephonyManager.listen(listener, PhoneStateListener.LISTEN_NONE) }
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

    @OptIn(ExperimentalCoroutinesApi::class)
    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLoggingLoop() {
        val locationClient = LocationServices.getFusedLocationProviderClient(this)

        coroutineScope.launch {
            while (isActive) {
                val location = try {
                    withTimeout(5000) {
                        suspendCancellableCoroutine<Location?> { cont ->
                            val request = com.google.android.gms.location.LocationRequest.Builder(
                                com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
                                1000L
                            )
                                .setWaitForAccurateLocation(true)
                                .setMaxUpdateDelayMillis(0)
                                .build()

                            locationClient.requestLocationUpdates(
                                request,
                                object : com.google.android.gms.location.LocationCallback() {
                                    override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
                                        cont.resume(result.lastLocation, onCancellation = null)
                                        locationClient.removeLocationUpdates(this)
                                    }
                                },
                                Looper.getMainLooper()
                            )
                        }
                    }
                } catch (e: Exception) {
                    Log.e("LoggerService", "Failed to get fresh location", e)
                    null
                }

                val lat = location?.latitude
                val lon = location?.longitude
                val latRounded = lat?.let(::roundCoordinate)
                val lonRounded = lon?.let(::roundCoordinate)

                val signalDbm = currentDbm

                val pingResult = when {
                    lat == null || lon == null || signalDbm == UNKNOWN_DBM -> PingResult.BAD
                    lastLat == null || lastLon == null -> PingResult.SUCCESS
                    !hasMoved(lat, lon, lastLat!!, lastLon!!, 10f)
                            && signalDbm == lastSignal -> {
                        Log.d("LoggerService", "Skipped — no move AND no signal change")
                        PingResult.DUPLICATE
                    }
                    else -> PingResult.SUCCESS
                }

                // Get SIM operator MCC and MNC
                val simOperator = telephonyManager.simOperator
                val simMcc = simOperator.take(3)
                val simMnc = simOperator.drop(3)

                // Get registered cell info
                val infoList = telephonyManager.allCellInfo
                val registeredInfo = infoList?.find { it.isRegistered }
                val identity = registeredInfo?.cellIdentity

                val (rawMcc, rawMnc) = when (identity) {
                    is CellIdentityLte   -> identity.mccString to identity.mncString
                    is CellIdentityNr    -> identity.mccString to identity.mncString
                    is CellIdentityGsm   -> identity.mccString to identity.mncString
                    is CellIdentityWcdma -> identity.mccString to identity.mncString
                    else                  -> null to null
                }
                val mcc = rawMcc ?: "?"
                val mnc = rawMnc ?: "?"

                val carrierName = getCarrierName(mcc, mnc)

                val cellInfoString = when (identity) {
                    is CellIdentityLte   -> "CI:${identity.ci}, TAC:${identity.tac}, PCI:${identity.pci}"
                    is CellIdentityNr    -> "CI:${identity.nci}, TAC:${identity.tac}, PCI:${identity.pci}"
                    is CellIdentityGsm   -> "CID:${identity.cid}, LAC:${identity.lac}"
                    is CellIdentityWcdma -> "CID:${identity.cid}, LAC:${identity.lac}"
                    else                  -> "Unknown Cell Identity"
                }

                val isSameCarrier = (mcc == simMcc && mnc == simMnc)

                if (pingResult == PingResult.SUCCESS && isSameCarrier) {
                    lastLat = lat
                    lastLon = lon
                    lastSignal = signalDbm

                    val pointId = UUID.nameUUIDFromBytes(
                        "$carrierName|$latRounded|$lonRounded|$signalDbm"
                            .toByteArray()
                    ).toString()

                    val entry = SignalLogEntry(
                        id = pointId,
                        timestamp = System.currentTimeMillis(),
                        latitude = latRounded!!,
                        longitude = lonRounded!!,
                        signalDbm = signalDbm,
                        carrier = carrierName,
                        mcc = mcc,
                        mnc = mnc,
                        cellInfo = cellInfoString
                    )

                    SignalLogger.logEntry(this@LoggerService, entry)

                } else if (pingResult == PingResult.SUCCESS && !isSameCarrier) {
                    Log.d("LoggerService", "Skipped — Not user carrier (SIM $simMcc$simMnc vs Tower $mcc$mnc)")
                }

                LoggerState.sample(lat, lon, signalDbm, pingResult)

                delay(5000)
            }
        }
    }

    private fun hasMoved(lat1: Double, lon1: Double, lat2: Double, lon2: Double, thresholdMeters: Float): Boolean {
        val result = FloatArray(1)
        Location.distanceBetween(lat1, lon1, lat2, lon2, result)
        return result[0] > thresholdMeters
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
        START_STICKY

    override fun onDestroy() {
        stopSignalListener?.invoke()
        stopSignalListener = null
        coroutineScope.cancel()
        LoggerState.serviceStopped()
        super.onDestroy()
    }
}
