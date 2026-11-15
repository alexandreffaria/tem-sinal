package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * The pending count, the LOG/STOP button, a dismissible [hint] below it, links that call
 * [onShowSharing], [onShowDataSent] and [onShowRecordings], and the location and signal lines:
 * stacked, or with the lines beside the button when [sideBySide]. Either way the content scrolls when the window is too
 * short for it; when it fits, it stays centred because the scroll keeps the filled
 * height as its minimum.
 */
@Composable
fun LoggerButton(
    isLogging: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    sideBySide: Boolean = false,
    location: UiText? = null,
    signalStrength: UiText? = null,
    service: List<UiText> = emptyList(),
    pendingPoints: Int = 0,
    hint: UiText? = null,
    onDismissHint: () -> Unit = {},
    onShowSharing: () -> Unit = {},
    onShowDataSent: () -> Unit = {},
    onShowRecordings: () -> Unit = {}
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
                LoggingControls(
                    isLogging, onToggle, pendingPoints, hint, onDismissHint, onShowSharing,
                    onShowDataSent, onShowRecordings
                )
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
            LoggingControls(
                isLogging, onToggle, pendingPoints, hint, onDismissHint, onShowSharing,
                onShowDataSent, onShowRecordings
            )
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
    pendingPoints: Int,
    hint: UiText?,
    onDismissHint: () -> Unit,
    onShowSharing: () -> Unit,
    onShowDataSent: () -> Unit,
    onShowRecordings: () -> Unit
) {
    Text(
        if (pendingPoints == 0) {
            stringResource(R.string.no_pending_points)
        } else {
            pluralStringResource(R.plurals.pending_points, pendingPoints, pendingPoints)
        }
    )
    Spacer(modifier = Modifier.height(50.dp))
    Button(
        onClick = onToggle,
        modifier = Modifier.size(200.dp)
    ) {
        Text(stringResource(if (isLogging) R.string.stop else R.string.log))
    }
    if (hint != null) {
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            hint.resolve(),
            modifier = Modifier.widthIn(max = 320.dp),
            textAlign = TextAlign.Center
        )
        TextButton(onClick = onDismissHint) {
            Text(stringResource(R.string.dismiss))
        }
    }
    TextButton(onClick = onShowSharing) {
        Text(stringResource(R.string.what_is_shared))
    }
    TextButton(onClick = onShowDataSent) {
        Text(stringResource(R.string.see_data_sent))
    }
    TextButton(onClick = onShowRecordings) {
        Text(stringResource(R.string.my_recordings))
    }
}

@Composable
private fun SignalLines(location: UiText?, signalStrength: UiText?, service: List<UiText>) {
    Text(location?.resolve() ?: "")
    Text(signalStrength?.resolve() ?: "")
    Text(service.map { it.resolve() }.joinToString("\n"))
}
