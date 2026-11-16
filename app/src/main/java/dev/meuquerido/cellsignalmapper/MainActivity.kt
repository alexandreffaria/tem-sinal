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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import android.telephony.TelephonyManager
import com.google.firebase.FirebaseApp

import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/** Holds, for the life of the process, whether the app has scheduled its upload on open. */
object UploadOnOpen {
    private val scheduled = AtomicBoolean(false)

    /** True on the first call in a process, false on every later one. */
    fun firstInProcess(): Boolean = scheduled.compareAndSet(false, true)
}

class MainActivity : ComponentActivity() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var telephonyManager: TelephonyManager

    /** The message shown instead of starting logging when a permission is denied; null otherwise. */
    private var permissionMessage by mutableStateOf<UiText?>(null)

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

    private val firstLogWarningFile get() = java.io.File(filesDir, FIRST_LOG_WARNING_FILE_NAME)

    /** Stops or starts logging; calls [showFirstLogWarning] instead when the first LOG is due. */
    private fun toggleLogging(showFirstLogWarning: () -> Unit) {
        if (LoggerState.state.value.isLogging) {
            stopService(Intent(this, LoggerService::class.java))
            return
        }
        if (firstLogWarningDue(firstLogWarningFile)) {
            showFirstLogWarning()
            return
        }
        startLogging()
    }

    /** Answers the first-LOG warning; it never shows again either way. */
    private fun answerFirstLogWarning(start: Boolean) {
        markFirstLogWarningShown(firstLogWarningFile)
        if (start) startLogging()
    }

    private fun startLogging() {
        val serviceIntent = Intent(this, LoggerService::class.java)
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
        // Sends what is pending once per process start, which includes a restore after the
        // process was killed. A rotation doesn't enqueue again, which would reset a running backoff.
        if (UploadOnOpen.firstInProcess()) UploadWorker.enqueue(this)


        lifecycleScope.launch(Dispatchers.IO) { FirestoreCache.delete(applicationContext) }
        lifecycleScope.launch(Dispatchers.IO) { SignalLogger.publishPendingCount(applicationContext) }


        setContent {
            CellSignalMapperTheme {
                val loggerState by LoggerState.state.collectAsState()
                // Held here, above the portrait and landscape layouts, so the dialog stays open
                // when the phone rotates.
                var showSharing by rememberSaveable { mutableStateOf(false) }
                if (showSharing) {
                    SharingDialog(onDismiss = { showSharing = false })
                }
                // Saved like showSharing, so a rotation keeps the first-LOG warning open.
                var showFirstLogWarning by rememberSaveable { mutableStateOf(false) }
                if (showFirstLogWarning) {
                    FirstLogWarningDialog(
                        onStart = {
                            showFirstLogWarning = false
                            answerFirstLogWarning(start = true)
                        },
                        onCancel = {
                            showFirstLogWarning = false
                            answerFirstLogWarning(start = false)
                        }
                    )
                }
                var showRecordings by rememberSaveable { mutableStateOf(false) }
                if (showRecordings) {
                    RecordingsDialog(onDismiss = { showRecordings = false })
                }
                var showDataSent by rememberSaveable { mutableStateOf(false) }
                if (showDataSent) {
                    // The dialog opens once the copy of the last sample is read.
                    var loaded by remember { mutableStateOf(false) }
                    var preview by remember { mutableStateOf<String?>(null) }
                    LaunchedEffect(Unit) {
                        preview = withContext(Dispatchers.IO) {
                            SignalLogger.lastSample(applicationContext)
                                ?.let { FirebaseUploader.preview(listOf(it)) }
                        }
                        loaded = true
                    }
                    if (loaded) {
                        DataSentDialog(
                            preview = preview,
                            onDismiss = { showDataSent = false },
                            onShowSharing = {
                                showDataSent = false
                                showSharing = true
                            }
                        )
                    }
                }
                MainScreen(
                    loggerState = loggerState,
                    permissionMessage = permissionMessage,
                    onToggle = { toggleLogging { showFirstLogWarning = true } },
                    onShowSharing = { showSharing = true },
                    onShowDataSent = { showDataSent = true },
                    onShowRecordings = { showRecordings = true }
                )
            }
        }

    }
}

