package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The pending count, the LOG/STOP and upload buttons, and the location and signal lines: stacked,
 * or with the lines beside the buttons when [sideBySide]. Either way the content scrolls when the
 * window is too short for it; when it fits, it stays centred because the scroll keeps the filled
 * height as its minimum.
 */
@Composable
fun LoggerButton(
    isLogging: Boolean,
    onToggle: () -> Unit,
    onUpload: () -> Unit,
    modifier: Modifier = Modifier,
    sideBySide: Boolean = false,
    location: String = "",
    signalStrength: String = "",
    service: String = "",
    pendingPoints: Int = 0
) {
    val scrolling = modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(16.dp)
    if (sideBySide) {
        Row(
            modifier = scrolling,
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                LoggingControls(isLogging, onToggle, onUpload, pendingPoints)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                SignalLines(location, signalStrength, service)
            }
        }
    } else {
        Column(
            modifier = scrolling,
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            LoggingControls(isLogging, onToggle, onUpload, pendingPoints)
            Spacer(modifier = Modifier.height(32.dp))
            SignalLines(location, signalStrength, service)
            Spacer(modifier = Modifier.height(100.dp))
        }
    }
}

@Composable
private fun LoggingControls(
    isLogging: Boolean,
    onToggle: () -> Unit,
    onUpload: () -> Unit,
    pendingPoints: Int
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
}

@Composable
private fun SignalLines(location: String, signalStrength: String, service: String) {
    Text(location)
    Text(signalStrength)
    Text(service)
}
