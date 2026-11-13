package dev.meuquerido.cellsignalmapper

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch


class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

    /** Shown instead of starting logging when a permission it needs is denied; null otherwise. */
    private var permissionMessage by mutableStateOf<String?>(null)

    /** Set when the LOG button asked for permissions, so logging starts once they are granted. */
    private var startLoggingWhenGranted = false

    private val requestedPermissions = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        add(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }.toTypedArray()

    // The check is for FragmentActivity, which routes results through androidx.fragment. This is a
    // ComponentActivity with no fragments, so its own result registry delivers the result.
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    private val permissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val startLogging = startLoggingWhenGranted
            startLoggingWhenGranted = false
            permissionMessage = currentDeniedMessage()
            if (startLogging && permissionMessage == null) {
                startForegroundService(Intent(this, LoggerService::class.java))
            }
        }

    private fun isGranted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun currentDeniedMessage() = loggingDeniedMessage(
        fineLocationGranted = isGranted(Manifest.permission.ACCESS_FINE_LOCATION),
        coarseLocationGranted = isGranted(Manifest.permission.ACCESS_COARSE_LOCATION),
        phoneStateGranted = isGranted(Manifest.permission.READ_PHONE_STATE),
    )

    private fun toggleLogging() {
        val serviceIntent = Intent(this, LoggerService::class.java)
        if (LoggerState.state.value.isLogging) {
            stopService(serviceIntent)
            return
        }
        permissionMessage = currentDeniedMessage()
        if (permissionMessage == null) {
            startForegroundService(serviceIntent)
        } else {
            startLoggingWhenGranted = true
            permissionRequest.launch(requestedPermissions)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (!requestedPermissions.all(::isGranted)) {
            permissionRequest.launch(requestedPermissions)
        }

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager

        FirebaseApp.initializeApp(this)
        FirebaseAuth.getInstance().signInAnonymously()
            .addOnSuccessListener {
                Log.d("Auth", "Signed in anonymously")
                FirebaseUploader.uploadLogFile(this) {
                    Log.d("MainActivity", "Retry upload on start: $it")
                }
            }
            .addOnFailureListener { Log.e("Auth", "Failed to sign in anonymously", it) }


        lifecycleScope.launch(Dispatchers.IO) { SignalLogger.publishPendingCount(applicationContext) }


        setContent {
            CellSignalMapperTheme {
                val loggerState by LoggerState.state.collectAsState()
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

                        permissionMessage?.let {
                            Text(it, modifier = Modifier.padding(horizontal = 16.dp))
                        }

                        LoggerButton(
                            isLogging = loggerState.isLogging,
                            onToggle = { toggleLogging() },
                            onUpload = {
                                FirebaseUploader.uploadLogFile(this@MainActivity) {
                                    Log.d("MainActivity", "Upload complete: $it")
                                }
                            },
                            location = loggerState.location,
                            signalStrength = loggerState.signalStrength,
                            pendingPoints = loggerState.pendingCount
                        )
                    }
                }
            }
        }

    }
}

