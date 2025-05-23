package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.location.Location
import android.os.IBinder
import android.telephony.TelephonyManager
import androidx.annotation.RequiresPermission
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.*

class LoggerService : Service() {

    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private lateinit var telephonyManager: TelephonyManager

    override fun onBind(intent: Intent?): IBinder? = null

    @RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    override fun onCreate() {
        super.onCreate()
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
                val locTask = locationClient.lastLocation
                val location = try {
                    kotlinx.coroutines.suspendCancellableCoroutine<Location?> { cont ->
                        locTask.addOnSuccessListener { cont.resume(it, null) }
                        locTask.addOnFailureListener { cont.resume(null, null) }
                    }
                } catch (e: Exception) {
                    null
                }

                val lat = location?.latitude
                val lon = location?.longitude

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

                val entry = SignalLogEntry(
                    timestamp = System.currentTimeMillis(),
                    latitude = lat,
                    longitude = lon,
                    signalDbm = signalDbm,
                    carrier = getCarrierName(mcc ?: "?", mnc ?: "?"),
                    mcc = mcc ?: "?",
                    mnc = mnc ?: "?",
                    cellInfo = cellInfo
                )

                SignalLogger.logEntry(this@LoggerService, entry)

                val intent = Intent("dev.meuquerido.cellsignalmapper.LOG_UPDATE").apply {
                    putExtra("location", "Lat: $lat, Lon: $lon")
                    putExtra("signal", "Signal Strength: $signalDbm dBm")
                    putExtra("cell", cellInfo)
                }
                sendBroadcast(intent)

                delay(1000)
            }
        }
    }

    override fun onDestroy() {
        coroutineScope.cancel()
        super.onDestroy()
    }
}
