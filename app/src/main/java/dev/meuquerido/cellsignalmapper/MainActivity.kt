package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
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
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import android.telephony.TelephonyManager
import android.util.Log
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.*
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth

import android.content.Intent
import android.content.IntentFilter
import android.content.Context
import androidx.compose.runtime.mutableIntStateOf


class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

    private var isLogging by mutableStateOf(false)

    private val locationText = mutableStateOf("Getting Location...")
    private val signalStrengthText = mutableStateOf("Getting Signal Strength...")
    private val cellInfoText = mutableStateOf(listOf("Getting tower info..."))

    private var pendingPoints by mutableIntStateOf(0)

    private val PERMISSIONS_REQUEST_CODE = 1001
    private val REQUIRED_PERMISSIONS = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.READ_PHONE_STATE
    )

    private val logUpdateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.let {
                locationText.value = it.getStringExtra("location") ?: ""
                signalStrengthText.value = it.getStringExtra("signal") ?: ""
                cellInfoText.value = listOf(it.getStringExtra("cell") ?: "")
                pendingPoints = FirebaseUploader.getPendingLogCount(applicationContext)
            }
        }
    }


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
        if (!isLogging) {
            val serviceIntent = Intent(this, LoggerService::class.java)
            startForegroundService(serviceIntent)
            isLogging = true
        } else {
            val stopIntent = Intent(this, LoggerService::class.java)
            stopService(stopIntent)
            isLogging = false
        }

        locationText.value = ""
        signalStrengthText.value = ""
        cellInfoText.value = emptyList()
    }



    @SuppressLint("UnspecifiedRegisterReceiverFlag")
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

        FirebaseUploader.uploadLogFile(this){
            Log.d(
                "MainActivity", "Retry upload on start: $it"
            )
        }

        registerReceiver(logUpdateReceiver, IntentFilter("dev.meuquerido.cellsignalmapper.LOG_UPDATE"))


        pendingPoints = FirebaseUploader.getPendingLogCount(this)


        setContent {
            CellSignalMapperTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    LoggerButton(
                        isLogging = isLogging,
                        onToggle = { toggleLogging() },
                        onUpload = { FirebaseUploader.uploadLogFile(this){
                            Log.d("MainActivity", "Upload complete: $it")
                            pendingPoints = FirebaseUploader.getPendingLogCount(this)
                        } },
                        location = locationText.value,
                        signalStrength = signalStrengthText.value,
                        cellInfo = cellInfoText.value,
                        pendingPoints = pendingPoints,
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
    onUpload: () -> Unit,
    modifier: Modifier = Modifier,
    location: String = "",
    signalStrength: String = "",
    cellInfo: List<String> = emptyList(),
    pendingPoints: Int = 0
) {



    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {


        Text("$pendingPoints pending points stored")
        Spacer(modifier = Modifier.height(50.dp))

        Button(
            onClick = onToggle,
            modifier = Modifier.size(200.dp)
        ) {
            Text(if (isLogging) "STOP" else "LOG")
        }

        if (pendingPoints > 0) {
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = onUpload) {
                Text("Send my data")
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Text(location)
        Text(signalStrength)
        cellInfo.forEach {
            Text(it)
        }
    }
}
