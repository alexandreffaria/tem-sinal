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

    enum class PingResult { SUCCESS, DUPLICATE, BAD }

    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private lateinit var telephonyManager: TelephonyManager

    // --- NEW: hold the real-time dBm ---
    private var currentDbm: Int = -999

    // --- NEW: modern callback for API31+ ---
    private val telephonyCallback = @RequiresApi(Build.VERSION_CODES.S)
    object : TelephonyCallback(),
        TelephonyCallback.SignalStrengthsListener {
        override fun onSignalStrengthsChanged(ss: SignalStrength) {
            // pick first available RAT
            val css = ss.cellSignalStrengths.firstOrNull()
            val dbm = css?.dbm
                ?: ss.gsmSignalStrength.takeIf { it != 99 }
                    ?.let { asu -> -113 + 2 * asu }
                ?: -999
            currentDbm = dbm
            Log.d("LoggerService", "Real-time dBm = $dbm")
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

        // --- NEW: register modern callback ---
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            telephonyManager.registerTelephonyCallback(mainExecutor, telephonyCallback)
        } else {
            // fallback if you ever care about pre-S: nothing here
        }

        startForegroundService()
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

    @OptIn(ExperimentalCoroutinesApi::class)
    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLoggingLoop() {
        val locationClient = LocationServices.getFusedLocationProviderClient(this)

        coroutineScope.launch {
            while (isActive) {
                // --- get fresh location ---
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
                val latRounded = lat?.let { "%.5f".format(it).toDouble() }
                val lonRounded = lon?.let { "%.5f".format(it).toDouble() }

                // --- use our real-time dBm instead of stale allCellInfo ---
                val signalDbm = currentDbm

                val pingResult = when {
                    lat == null || lon == null || signalDbm == -999 -> PingResult.BAD
                    lastLat == null || lastLon == null -> PingResult.SUCCESS
                    !hasMoved(lat, lon, lastLat!!, lastLon!!, 10f)
                            && signalDbm == lastSignal -> {
                        Log.d("LoggerService", "Skipped — no move AND no signal change")
                        PingResult.DUPLICATE
                    }
                    else -> PingResult.SUCCESS
                }

                if (pingResult == PingResult.SUCCESS) {
                    lastLat = lat
                    lastLon = lon
                    lastSignal = signalDbm

                    // get the registered cell info list
                    val infoList = telephonyManager.allCellInfo
                    val registeredInfo = infoList?.find { it.isRegistered }
                    val identity = registeredInfo?.cellIdentity

// extract MCC/MNC
                    val (rawMcc, rawMnc) = when (identity) {
                        is CellIdentityLte   -> identity.mccString to identity.mncString
                        is CellIdentityNr    -> identity.mccString to identity.mncString
                        is CellIdentityGsm   -> identity.mccString to identity.mncString
                        is CellIdentityWcdma -> identity.mccString to identity.mncString
                        else                  -> null to null
                    }
                    val mcc = rawMcc ?: "?"
                    val mnc = rawMnc ?: "?"

// lookup carrier name
                    val carrierName = getCarrierName(mcc, mnc)

// format a human-readable cell-info string
                    val cellInfoString = when (identity) {
                        is CellIdentityLte   -> "CI:${identity.ci}, TAC:${identity.tac}, PCI:${identity.pci}"
                        is CellIdentityNr    -> "CI:${identity.nci}, TAC:${identity.tac}, PCI:${identity.pci}"
                        is CellIdentityGsm   -> "CID:${identity.cid}, LAC:${identity.lac}"
                        is CellIdentityWcdma -> "CID:${identity.cid}, LAC:${identity.lac}"
                        else                  -> "Unknown Cell Identity"
                    }

// regenerate your point ID including the real carrier
                    val pointId = UUID.nameUUIDFromBytes(
                        "$carrierName|$latRounded|$lonRounded|$signalDbm"
                            .toByteArray()
                    ).toString()

// build the log entry with real carrier, mcc, mnc, and cellInfo
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
                }

                // … broadcast update as you had it …
                val intent = Intent("dev.meuquerido.cellsignalmapper.LOG_UPDATE").apply {
                    putExtra("location", "Lat: $lat, Lon: $lon")
                    putExtra("signal", "Signal Strength: $signalDbm dBm")
                    putExtra("pingResult", pingResult.name)
                    putExtra("debug", "")
                }
                sendBroadcast(intent)

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
        // unregister callback on API31+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            telephonyManager.unregisterTelephonyCallback(telephonyCallback)
        }
        coroutineScope.cancel()
        super.onDestroy()
    }
}
