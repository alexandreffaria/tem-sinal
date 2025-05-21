package com.example.cellsignalmapper

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.RequiresPermission
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.example.cellsignalmapper.ui.theme.CellSignalMapperTheme
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.*
import android.telephony.TelephonyManager
import android.util.Log
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.*
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth


class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

    private var isLogging by mutableStateOf(false)

    private val locationText = mutableStateOf("Getting Location...")
    private val signalStrengthText = mutableStateOf("Getting Signal Strength...")
    private val cellInfoText = mutableStateOf(listOf("Getting tower info..."))

    private var updateJob: Job? = null

    private val PERMISSIONS_REQUEST_CODE = 1001
    private val REQUIRED_PERMISSIONS = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.READ_PHONE_STATE
    )

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermissionsIfNecessary() {
        if (!allPermissionsGranted()) {
            ActivityCompat.requestPermissions(
                this,
                REQUIRED_PERMISSIONS,
                PERMISSIONS_REQUEST_CODE
            )
        }
    }

    @RequiresPermission(allOf = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION])
    private fun startLocationUpdates() {
        updateJob = CoroutineScope(Dispatchers.Main).launch {
            while (isActive) {
                if (allPermissionsGranted()) {
                    fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                        locationText.value = if (location != null) {
                            "Latitude: ${location.latitude}, Longitude: ${location.longitude}"
                        } else {
                            "Location not available"
                        }
                    }

                    val cellInfoList = telephonyManager.allCellInfo
                    val signalInfo = cellInfoList?.firstOrNull()
                    val strength = when (signalInfo) {
                        is android.telephony.CellInfoGsm -> signalInfo.cellSignalStrength.dbm
                        is android.telephony.CellInfoLte -> signalInfo.cellSignalStrength.dbm
                        is android.telephony.CellInfoNr -> signalInfo.cellSignalStrength.dbm
                        is android.telephony.CellInfoWcdma -> signalInfo.cellSignalStrength.dbm
                        else -> null
                    }
                    signalStrengthText.value = strength?.let { "Signal Strength: $it dBm" }
                        ?: "Signal Strength not available"

                    cellInfoText.value = getFormattedCellInfo(this@MainActivity)
                }
                if (locationText.value.startsWith("Latitude:") && signalStrengthText.value.contains("dBm")) {
                    val lat = locationText.value.substringAfter("Latitude: ").substringBefore(",").toDoubleOrNull()
                    val lon = locationText.value.substringAfter("Longitude: ").toDoubleOrNull()
                    val signal = signalStrengthText.value.substringAfter("Signal Strength: ").substringBefore(" ").toIntOrNull()

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

                    val entry = SignalLogEntry(
                        timestamp = System.currentTimeMillis(),
                        latitude = lat,
                        longitude = lon,
                        signalDbm = signal ?: -999,
                        carrier = getCarrierName(mcc ?: "?", mnc ?: "?"),
                        mcc = mcc ?: "?",
                        mnc = mnc ?: "?",
                        cellInfo = cellInfo
                    )

                    SignalLogger.logEntry(this@MainActivity, entry)
                }

                delay(1000)
            }
        }
    }

    @RequiresPermission(allOf = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION])
    private fun toggleLogging() {
        if (!isLogging) {
            startLocationUpdates()
            isLogging = true
        } else {
            updateJob?.cancel()
            updateJob = null
            isLogging = false
            locationText.value = ""
            signalStrengthText.value = ""
            cellInfoText.value = emptyList()

            FirebaseUploader.uploadLogFile(this) {
                Log.d("MainActivity", "Upload complete: $it")
            }
        }
    }


    @RequiresPermission(allOf = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION])
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestPermissionsIfNecessary()

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager

        FirebaseApp.initializeApp(this)
        FirebaseAuth.getInstance().signInAnonymously()
            .addOnSuccessListener { Log.d("Auth", "Signed in anonymously") }
            .addOnFailureListener { Log.e("Auth", "Failed to sign in anonymously", it) }


        setContent {
            CellSignalMapperTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    LoggerButton(
                        isLogging = isLogging,
                        onToggle = { toggleLogging() },
                        location = locationText.value,
                        signalStrength = signalStrengthText.value,
                        cellInfo = cellInfoText.value,
                        modifier = Modifier.padding(innerPadding)
                    )

                }
            }
        }
    }
}

@Composable
fun LoggerButton(
    isLogging: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    location: String = "",
    signalStrength: String = "",
    cellInfo: List<String> = emptyList()
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Button(
            onClick = onToggle,
            modifier = Modifier.size(200.dp)
        ) {
            Text(if (isLogging) "STOP" else "LOG")
        }

        Spacer(modifier = Modifier.height(32.dp))

        Text(location)
        Text(signalStrength)
        cellInfo.forEach {
            Text(it)
        }
    }
}
