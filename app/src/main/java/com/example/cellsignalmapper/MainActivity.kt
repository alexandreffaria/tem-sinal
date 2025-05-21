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

class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

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
                delay(1000)
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

        startLocationUpdates()

        setContent {
            CellSignalMapperTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Greeting(
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
fun Greeting(location: String, signalStrength: String, cellInfo: List<String>, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(text = location)
        Text(text = signalStrength)
        cellInfo.forEach { line ->
            Text(text = line)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
    CellSignalMapperTheme {
        Greeting(
            location = "Preview Location",
            signalStrength = "Preview Signal Strength",
            cellInfo = listOf("Tower 1 info", "Tower 2 info")
        )
    }
}
