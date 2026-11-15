package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * Shows [preview], the [uploadPreview] of the most recently logged sample, below what it is; null
 * says no sample was logged yet. [onShowSharing] opens the explanation of what is shared. The text
 * scrolls when the window is too short for it.
 */
@Composable
fun DataSentDialog(preview: String?, onDismiss: () -> Unit, onShowSharing: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.dismiss))
            }
        },
        dismissButton = {
            TextButton(onClick = onShowSharing) {
                Text(stringResource(R.string.what_is_shared))
            }
        },
        title = { Text(stringResource(R.string.see_data_sent)) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.data_sent_explained))
                Spacer(modifier = Modifier.height(12.dp))
                if (preview == null) {
                    Text(UiText(R.string.data_sent_none, listOf(UiText(R.string.log))).resolve())
                } else {
                    SelectionContainer {
                        Text(
                            preview,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
    )
}
