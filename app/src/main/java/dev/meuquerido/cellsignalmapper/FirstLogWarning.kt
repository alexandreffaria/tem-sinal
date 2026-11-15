package dev.meuquerido.cellsignalmapper

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import java.io.File

/** The file in `Context.getFilesDir()` whose presence says the first-LOG warning was shown. */
const val FIRST_LOG_WARNING_FILE_NAME = "first_log_warning_shown"

/** True until [markFirstLogWarningShown] was called on [file]: only the first LOG warns. */
fun firstLogWarningDue(file: File): Boolean = !file.exists()

/** Records in [file] that the first-LOG warning was shown, so it never shows again. */
fun markFirstLogWarningShown(file: File) {
    file.createNewFile()
}

/** Warns, before the first recording, not to start LOG at home. */
@Composable
fun FirstLogWarningDialog(onStart: () -> Unit, onCancel: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            TextButton(onClick = onStart) {
                Text(stringResource(R.string.first_log_start))
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel) {
                Text(stringResource(R.string.cancel))
            }
        },
        text = { Text(UiText(R.string.first_log_warning, listOf(UiText(R.string.log))).resolve()) }
    )
}
