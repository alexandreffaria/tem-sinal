package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The recordings sent from this phone, newest first, each with its date, its sample count and a
 * Delete button that asks once before deleting it from the server. The list scrolls when the
 * window is too short for it.
 */
@Composable
fun RecordingsDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    var recordings by remember { mutableStateOf<List<Recording>?>(null) }
    var confirming by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { recordings = withContext(Dispatchers.IO) { Recordings.list(context) } }

    confirming?.let { sessionId ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            confirmButton = {
                TextButton(onClick = {
                    confirming = null
                    deleting = sessionId
                    failed = false
                    scope.launch {
                        failed = !FirebaseUploader.deleteRecording(context, sessionId)
                        recordings = withContext(Dispatchers.IO) { Recordings.list(context) }
                        deleting = null
                    }
                }) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = null }) { Text(stringResource(R.string.cancel)) }
            },
            title = { Text(stringResource(R.string.delete_recording_title)) },
            text = { Text(stringResource(R.string.delete_recording_text)) },
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.dismiss)) }
        },
        title = { Text(stringResource(R.string.my_recordings)) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                if (failed) Text(stringResource(R.string.delete_failed))
                val list = recordings
                if (list != null && list.isEmpty()) Text(stringResource(R.string.no_recordings))
                // The list starts with the update that added it; older uploads were never listed.
                Text(stringResource(R.string.recordings_before_update), style = MaterialTheme.typography.bodySmall)
                val format = remember { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT) }
                list?.forEach { recording ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(format.format(Date(recording.startMs)))
                            Text(pluralStringResource(R.plurals.recording_points, recording.samples, recording.samples))
                        }
                        TextButton(
                            onClick = { confirming = recording.sessionId },
                            enabled = deleting == null,
                        ) {
                            Text(stringResource(if (deleting == recording.sessionId) R.string.deleting else R.string.delete))
                        }
                    }
                }
            }
        },
    )
}
