package dev.meuquerido.cellsignalmapper

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import android.telephony.TelephonyManager
import android.util.Log
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.*
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth

import android.content.Intent
import androidx.compose.runtime.mutableIntStateOf


class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

    private var pendingPoints by mutableIntStateOf(0)

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

    private fun toggleLogging() {
        val serviceIntent = Intent(this, LoggerService::class.java)
        if (LoggerState.state.value.isLogging) {
            stopService(serviceIntent)
        } else {
            startForegroundService(serviceIntent)
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
            .addOnSuccessListener {
                Log.d("Auth", "Signed in anonymously")
                FirebaseUploader.uploadLogFile(this) {
                    Log.d("MainActivity", "Retry upload on start: $it")
                    pendingPoints = FirebaseUploader.getPendingLogCount(this)
                }
            }
            .addOnFailureListener { Log.e("Auth", "Failed to sign in anonymously", it) }


        pendingPoints = FirebaseUploader.getPendingLogCount(this)


        setContent {
            CellSignalMapperTheme {
                val loggerState by LoggerState.state.collectAsState()
                LaunchedEffect(loggerState.sampleCount) {
                    if (loggerState.sampleCount > 0) {
                        pendingPoints = FirebaseUploader.getPendingLogCount(this@MainActivity)
                    }
                }
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        PingVisualizer(
                            result = loggerState.pingResult?.name ?: "",
                            animationKey = loggerState.sampleCount
                        )

                        Spacer(modifier = Modifier.height(24.dp))

                        LoggerButton(
                            isLogging = loggerState.isLogging,
                            onToggle = { toggleLogging() },
                            onUpload = {
                                FirebaseUploader.uploadLogFile(this@MainActivity) {
                                    Log.d("MainActivity", "Upload complete: $it")
                                    pendingPoints = FirebaseUploader.getPendingLogCount(this@MainActivity)
                                }
                            },
                            location = loggerState.location,
                            signalStrength = loggerState.signalStrength,
                            pendingPoints = pendingPoints,
                            debugText = ""
                        )
                    }
                }
            }
        }

    }
}

