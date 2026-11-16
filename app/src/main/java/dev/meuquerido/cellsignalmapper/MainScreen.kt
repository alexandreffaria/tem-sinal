package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The main screen: the ping visualizer and [LoggerButton] showing [loggerState], with
 * [permissionMessage] above the button while a permission is denied. Stacked, or in a row when the
 * window is wider than tall.
 */
@Composable
fun MainScreen(
    loggerState: LoggerUiState,
    permissionMessage: UiText?,
    onToggle: () -> Unit,
    onShowSharing: () -> Unit,
    onShowDataSent: () -> Unit,
    onShowRecordings: () -> Unit
) {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        val controls = @Composable { sideBySide: Boolean ->
            permissionMessage?.let {
                Text(it.resolve(), modifier = Modifier.padding(horizontal = 16.dp))
            }

            LoggerButton(
                isLogging = loggerState.isLogging,
                onToggle = onToggle,
                sideBySide = sideBySide,
                location = loggerState.location,
                signalStrength = loggerState.signalStrength,
                service = loggerState.service,
                pendingPoints = loggerState.pendingCount,
                hint = loggerState.hint,
                onDismissHint = { LoggerState.dismissHint() },
                onShowSharing = onShowSharing,
                onShowDataSent = onShowDataSent,
                onShowRecordings = onShowRecordings
            )
        }
        val pingResult = loggerState.pingResult?.name ?: ""
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // Wider than tall, as in landscape: the visualizer, buttons and lines sit
            // in a row, because stacked they don't fit the height.
            if (maxWidth > maxHeight) {
                Row(
                    modifier = Modifier.fillMaxSize(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    PingVisualizer(
                        result = pingResult,
                        modifier = Modifier.padding(start = 32.dp),
                        animationKey = loggerState.sampleCount
                    )
                    Column(
                        modifier = Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        controls(true)
                    }
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    PingVisualizer(
                        result = pingResult,
                        animationKey = loggerState.sampleCount
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    controls(false)
                }
            }
        }
    }
}
