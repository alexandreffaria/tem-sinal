package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/** What a sample holds, when it leaves the phone, what Firebase receives, and what is public. */
private val sharingParagraphs = listOf(
    UiText(R.string.sharing_recording, listOf(UiText(R.string.log), UiText(R.string.stop))),
    UiText(R.string.sharing_sample),
    UiText(R.string.sharing_server),
    UiText(R.string.sharing_firebase),
    UiText(R.string.sharing_personal),
    UiText(R.string.sharing_map),
)

/** Explains what is shared; the text scrolls when the window is too short for it. */
@Composable
fun SharingDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.dismiss))
            }
        },
        title = { Text(stringResource(R.string.what_is_shared)) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                sharingParagraphs.forEachIndexed { i, paragraph ->
                    if (i > 0) Spacer(modifier = Modifier.height(12.dp))
                    Text(paragraph.resolve())
                }
            }
        }
    )
}
