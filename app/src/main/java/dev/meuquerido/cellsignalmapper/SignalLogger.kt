package dev.meuquerido.cellsignalmapper

import android.content.Context
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.io.File

object SignalLogger {
    private val gson: Gson = GsonBuilder().create()
    private const val LOG_FILE_NAME = "signal_log.json"
    private const val PENDING_FILE_NAME = "signal_log.pending.json"

    fun logEntry(context: Context, entry: SignalLogEntry) {
        appendLine(getLogFile(context), gson.toJson(entry))
    }

    fun getLogFile(context: Context): File = File(context.filesDir, LOG_FILE_NAME)

    fun getPendingFile(context: Context): File = File(context.filesDir, PENDING_FILE_NAME)

    /** Appends [line] to [log]. Never runs at the same time as [takePending]. */
    @Synchronized
    fun appendLine(log: File, line: String) {
        log.appendText(line + "\n")
    }

    /**
     * Moves every line in [log] to the end of [pending] and returns [pending], or null when there
     * is nothing to upload. Lines appended afterwards go to a new [log], so deleting [pending]
     * after an upload never deletes a sample that wasn't read for it.
     */
    @Synchronized
    fun takePending(log: File, pending: File): File? {
        if (log.exists()) {
            if (!pending.exists()) {
                check(log.renameTo(pending)) { "Could not rename the log to the pending file" }
            } else {
                pending.appendBytes(log.readBytes())
                log.delete()
            }
        }
        return pending.takeIf { it.exists() && it.length() > 0 }
    }
}
