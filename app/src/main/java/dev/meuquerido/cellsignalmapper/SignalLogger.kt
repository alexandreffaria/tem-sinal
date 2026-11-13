package dev.meuquerido.cellsignalmapper

import android.content.Context
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.io.File
import java.io.RandomAccessFile

object SignalLogger {
    private val gson: Gson = GsonBuilder().create()
    private const val LOG_FILE_NAME = "signal_log.json"
    private const val PENDING_FILE_NAME = "signal_log.pending.json"
    private const val REJECTED_FILE_NAME = "signal_log.rejected.json"

    fun logEntry(context: Context, entry: SignalLogEntry) {
        appendLine(getLogFile(context), gson.toJson(entry))
    }

    fun getLogFile(context: Context): File = File(context.filesDir, LOG_FILE_NAME)

    fun getPendingFile(context: Context): File = File(context.filesDir, PENDING_FILE_NAME)

    /** Lines that are not a sample; never uploaded and never deleted by an upload. */
    fun getRejectedFile(context: Context): File = File(context.filesDir, REJECTED_FILE_NAME)

    /**
     * Appends [line] to [log] on a line of its own, even when [log] ends with a line torn by a
     * killed process. Never runs at the same time as [takePending].
     */
    @Synchronized
    fun appendLine(log: File, line: String) {
        log.appendText(startOfLine(log) + line + "\n")
    }

    /** Appends [lines] to [rejected], then deletes [pending]. */
    fun keepRejected(pending: File, rejected: File, lines: List<String>) {
        lines.forEach { appendLine(rejected, it) }
        pending.delete()
    }

    /** A newline when [file] ends inside a line, so that what is written next starts its own line. */
    private fun startOfLine(file: File): String {
        if (!file.exists() || file.length() == 0L) return ""
        RandomAccessFile(file, "r").use {
            it.seek(it.length() - 1)
            return if (it.read() == '\n'.code) "" else "\n"
        }
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
                pending.appendBytes(startOfLine(pending).toByteArray() + log.readBytes())
                log.delete()
            }
        }
        return pending.takeIf { it.exists() && it.length() > 0 }
    }
}
