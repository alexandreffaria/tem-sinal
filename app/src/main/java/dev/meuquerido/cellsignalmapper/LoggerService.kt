package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.location.Location
import android.os.IBinder
import android.os.Looper
import android.telephony.TelephonyManager
import android.util.Log
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.*
import java.util.UUID

class LoggerService : Service() {

    enum class PingResult {
        SUCCESS, DUPLICATE, BAD
    }

    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private lateinit var telephonyManager: TelephonyManager

    private var lastLat: Double? = null
    private var lastLon: Double? = null
    private var lastSignal: Int? = null

    override fun onBind(intent: Intent?): IBinder? = null

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    override fun onCreate() {
        super.onCreate()
        Log.d("LoggerService", "Service created and starting logging loop")

        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
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
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun startLoggingLoop() {
        val locationClient = LocationServices.getFusedLocationProviderClient(this)


        coroutineScope.launch {
            while (isActive) {
                Log.d("LoggerService", "Requesting last location...")
                val location = try {
                    withTimeout(5000) {
                        suspendCancellableCoroutine<Location?> { cont ->
                            val request = com.google.android.gms.location.LocationRequest.Builder(
                                com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY, 1000L
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
                val latRounded = "%.5f".format(lat).toDouble()
                val lonRounded = "%.5f".format(lon).toDouble()




                val registered = telephonyManager.allCellInfo?.find { it.isRegistered }
                val identity = registered?.cellIdentity

                val (mcc, mnc) = when (identity) {
                    is android.telephony.CellIdentityLte -> identity.mccString to identity.mncString
                    is android.telephony.CellIdentityNr -> identity.mccString to identity.mncString
                    is android.telephony.CellIdentityGsm -> identity.mccString to identity.mncString
                    is android.telephony.CellIdentityWcdma -> identity.mccString to identity.mncString
                    else -> null to null
                }

                val cellInfo = when (identity) {
                    is android.telephony.CellIdentityLte -> "CI: ${identity.ci}, TAC: ${identity.tac}, PCI: ${identity.pci}"
                    is android.telephony.CellIdentityNr -> "CI: ${identity.nci}, TAC: ${identity.tac}, PCI: ${identity.pci}"
                    is android.telephony.CellIdentityGsm -> "CID: ${identity.cid}, LAC: ${identity.lac}"
                    is android.telephony.CellIdentityWcdma -> "CID: ${identity.cid}, LAC: ${identity.lac}"
                    else -> "Unknown"
                }

                val signalDbm = registered?.cellSignalStrength?.dbm ?: -999

                val pingResult = when {
                    lat == null || lon == null || signalDbm == -999 -> PingResult.BAD
                    lastLat == null || lastLon == null -> PingResult.SUCCESS // first fix
                    !hasMoved(lat, lon, lastLat!!, lastLon!!, 10f) -> {
                        Log.d("LoggerService", "Skipped point — no significant movement")
                        PingResult.DUPLICATE
                    }
                    else -> PingResult.SUCCESS
                }
                if (pingResult == PingResult.SUCCESS) {
                    // Log point
                    lastLat = lat
                    lastLon = lon
                    lastSignal = signalDbm

                    val carrierName = getCarrierName(mcc ?: "?", mnc ?: "?")
                    val pointId = UUID.nameUUIDFromBytes("$carrierName|$latRounded|$lonRounded|$signalDbm".toByteArray()).toString()

                    val entry = SignalLogEntry(
                        id = pointId,
                        timestamp = System.currentTimeMillis(),
                        latitude = latRounded,
                        longitude = lonRounded,
                        signalDbm = signalDbm,
                        carrier = carrierName,
                        mcc = mcc ?: "?",
                        mnc = mnc ?: "?",
                        cellInfo = cellInfo
                    )

                    SignalLogger.logEntry(this@LoggerService, entry)
                }

                val distance = if (lastLat != null && lastLon != null && lat != null && lon != null) {
                    val result = FloatArray(1)
                    Location.distanceBetween(lastLat!!, lastLon!!, lat, lon, result)
                    result[0] // distance in meters
                } else {
                    0f
                }

                val debugInfo = "GPS=$lat, $lon | S=$signalDbm | PING=$pingResult | Δ=${
                    "%.1f".format(
                        distance
                    )
                }m\""
                val intent = Intent("dev.meuquerido.cellsignalmapper.LOG_UPDATE").apply {
                    putExtra("location", "Lat: $lat, Lon: $lon")
                    putExtra("signal", "Signal Strength: $signalDbm dBm")
                    putExtra("cell", cellInfo)
                    putExtra("pingResult", pingResult.name)
                    putExtra("debug", debugInfo)
                }
                sendBroadcast(intent)

                delay(5000)



            }

        }
    }

    private fun hasMoved(lat1: Double, lon1: Double, lat2: Double, lon2: Double, thresholdMeters: Float = 10f): Boolean {
        val result = FloatArray(1)
        Location.distanceBetween(lat1, lon1, lat2, lon2, result)
        return result[0] > thresholdMeters
    }


    override fun onDestroy() {
        coroutineScope.cancel()
        super.onDestroy()
    }
}
