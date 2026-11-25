package dev.meuquerido.cellsignalmapper

import android.os.SystemClock
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

/** The public map of the aggregated samples. */
const val MAP_URL = "https://comsinal.com.br/"

/**
 * The main screen over the [Hills] and [Birds]: the wordmark and, while recording, how long it
 * has run; [permissionMessage] while a permission is denied; the [LoggerButton] and the hint
 * below it; the [SignalCards] of [loggerState]; and the links to the map, [onShowRecordings],
 * [onShowSharing] and [onShowDataSent]. In one column, or two when the window is wider than tall.
 * The content scrolls when the window is too short for it; when it fits, the links sit at the
 * bottom, because the scroll keeps the window's height as its minimum.
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
    Box(Modifier.fillMaxSize()) {
        Hills(Modifier.fillMaxSize())
        Birds(Modifier.fillMaxWidth().fillMaxHeight(0.5f))
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
            val fill = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 28.dp)
            val top = @Composable {
                TopRow(loggerState)
                permissionMessage?.let { Note(it) }
                LoggerButton(loggerState.isLogging, onToggle, loggerState.pendingCount)
                loggerState.hint?.let { Note(it, onDismiss = { LoggerState.dismissHint() }) }
            }
            val cards = @Composable {
                SignalCards(loggerState.sims, loggerState.gps, loggerState.signalStrength)
            }
            val links = @Composable { Links(onShowSharing, onShowDataSent, onShowRecordings) }
            // Wider than tall, as in landscape: two columns, because stacked they don't fit.
            if (maxWidth > maxHeight) {
                Row(
                    fill,
                    horizontalArrangement = Arrangement.spacedBy(32.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(
                        Modifier.weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(20.dp)
                    ) { top() }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        cards()
                        links()
                    }
                }
            } else {
                Column(fill, verticalArrangement = Arrangement.SpaceBetween) {
                    Column(
                        Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(24.dp)
                    ) {
                        top()
                        cards()
                    }
                    Box(Modifier.padding(top = 24.dp)) { links() }
                }
            }
        }
    }
}

/** The wordmark, and while recording a pill with a slowly pulsing dot and the time it has run. */
@Composable
private fun TopRow(loggerState: LoggerUiState) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            stringResource(R.string.app_name).lowercase(),
            color = Ink,
            fontFamily = SpaceGrotesk,
            fontWeight = FontWeight.SemiBold,
            fontSize = 24.sp,
            letterSpacing = (-0.3).sp
        )
        val startedAtMs = loggerState.startedAtMs
        if (loggerState.isLogging && startedAtMs != null) {
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            // Updates only while the activity is started, on each whole minute of the recording.
            val now by produceState(SystemClock.elapsedRealtime(), startedAtMs, lifecycle) {
                lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    while (true) {
                        value = SystemClock.elapsedRealtime()
                        delay(msUntilNextMinute(value - startedAtMs))
                    }
                }
            }
            val pulse by rememberInfiniteTransition(label = "recording").animateFloat(
                initialValue = 1f,
                targetValue = 0.35f,
                animationSpec = infiniteRepeatable(tween(1_200), RepeatMode.Reverse),
                label = "dot"
            )
            Row(
                Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(PillWhite)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Grey while the last tick logged nothing, as without a fix.
                val dot = if (loggerState.pingResult == PingResult.BAD) InkMuted else Teal
                Box(Modifier.size(7.dp).alpha(pulse).background(dot, CircleShape))
                Text(
                    UiText(R.string.recording_elapsed, listOf(elapsedText(now - startedAtMs))).resolve(),
                    color = Teal,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

/** The card of links: the map (in the browser) and the recordings, then two small links. */
@Composable
private fun Links(onShowSharing: () -> Unit, onShowDataSent: () -> Unit, onShowRecordings: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(CardWhite)
            .padding(start = 16.dp, top = 4.dp, end = 16.dp, bottom = 4.dp)
    ) {
        LinkRow(stringResource(R.string.see_map)) {
            // Throws IllegalArgumentException when no app on the phone can open a web page;
            // the tap then does nothing.
            try {
                uriHandler.openUri(MAP_URL)
            } catch (_: IllegalArgumentException) {
            }
        }
        HorizontalDivider(color = Divider)
        LinkRow(stringResource(R.string.my_recordings), onShowRecordings)
        HorizontalDivider(color = Divider)
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            SmallLink(stringResource(R.string.what_is_shared), onShowSharing)
            SmallLink(stringResource(R.string.see_data_sent), onShowDataSent)
        }
    }
}

@Composable
private fun LinkRow(text: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .clearAndSetSemantics { contentDescription = text }
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text, color = Teal, fontSize = 15.sp)
        Text("→", color = Teal, fontSize = 15.sp)
    }
}

@Composable
private fun SmallLink(text: String, onClick: () -> Unit) {
    Text(
        text,
        modifier = Modifier
            .widthIn(min = 48.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 14.dp),
        color = InkSoft,
        fontSize = 13.sp,
        textDecoration = TextDecoration.Underline
    )
}
