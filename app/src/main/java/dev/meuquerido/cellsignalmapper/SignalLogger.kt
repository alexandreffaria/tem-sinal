package dev.meuquerido.cellsignalmapper

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile

object SignalLogger {
    private val gson: Gson = GsonBuilder().create()
    private const val LOG_FILE_NAME = "signal_log.json"
    private const val PENDING_FILE_NAME = "signal_log.pending.json"
    private const val REJECTED_FILE_NAME = "signal_log.rejected.json"
    private const val LAST_FILE_NAME = "signal_log.last.json"

    /**
     * The number of non-blank lines in each file whose count is known. Every change to a file here
     * updates its entry under the lock, or removes it when the result is uncertain (the change
     * threw), so the next [pendingCount] reads that file once instead.
     */
    private val lineCounts = mutableMapOf<File, Int>()

    /**
     * Appends [entry] to the log, replaces the copy in [getLastFile] with it, and publishes the
     * pending count. A failure to write the copy leaves the logged sample as it is. Not for the
     * main thread.
     */
    fun logEntry(context: Context, entry: Sample) {
        val line = gson.toJson(entry)
        appendLine(getLogFile(context), line)
        try {
            replaceFile(getLastFile(context), line + "\n")
        } catch (e: IOException) {
            Log.w("SignalLogger", "Could not keep a copy of the last sample", e)
        }
        publishPendingCount(context)
    }

    /**
     * The most recently logged sample, or null when none was logged or its copy can't be read.
     * Reads a file: not for the main thread.
     */
    fun lastSample(context: Context): Sample? =
        try {
            parseLog(getLastFile(context).readLines(), gson).samples.lastOrNull()
        } catch (e: IOException) {
            null
        }

    /**
     * Publishes to [LoggerState] the number of samples not uploaded yet. Counting and publishing
     * hold the lock, so a later publish never carries an older count. Never throws: when the files
     * can't be read it logs the failure and the last published count stays. Reads files: not for
     * the main thread.
     */
    @Synchronized
    fun publishPendingCount(context: Context) {
        countPending(getLogFile(context), getPendingFile(context)).fold(LoggerState::pendingCount) {
            Log.e("SignalLogger", "Could not count pending samples", it)
        }
    }

    /** [pendingCount], or the failure that stopped it: a file can't be read. */
    fun countPending(log: File, pending: File): Result<Int> =
        try {
            Result.success(pendingCount(log, pending))
        } catch (e: IOException) {
            Result.failure(e)
        }

    /**
     * The non-blank lines in [log] and [pending]. Holds the lock that [takePending] and
     * [keepRejected] hold, so no line is counted twice or missed while it moves between files.
     * Reads a file only when its count is not known; after that, changes made here keep it.
     */
    @Synchronized
    fun pendingCount(log: File, pending: File): Int = knownLines(log) + knownLines(pending)

    private fun knownLines(file: File): Int = lineCounts.getOrPut(file) { countLines(file) }

    /** Reads [file] line by line, without holding it in memory. A missing file has no lines. */
    private fun countLines(file: File): Int =
        if (file.exists()) file.useLines { lines -> lines.count { it.isNotBlank() } } else 0

    fun getLogFile(context: Context): File = File(context.filesDir, LOG_FILE_NAME)

    fun getPendingFile(context: Context): File = File(context.filesDir, PENDING_FILE_NAME)

    /**
     * A copy of the most recently logged sample, kept after it is uploaded so the app can show what
     * it sends; never uploaded itself.
     */
    fun getLastFile(context: Context): File = File(context.filesDir, LAST_FILE_NAME)

    /** Lines that are not a sample; never uploaded and never deleted by an upload. */
    fun getRejectedFile(context: Context): File = File(context.filesDir, REJECTED_FILE_NAME)

    /**
     * Appends [line] to [log] on a line of its own, even when [log] ends with a line torn by a
     * killed process or a power cut, and returns once the line is on storage. Never runs at the
     * same time as [takePending].
     */
    @Synchronized
    fun appendLine(log: File, line: String) {
        val known = lineCounts.remove(log)
        appendDurably(log, (startOfLine(log) + line + "\n").toByteArray())
        if (known != null) lineCounts[log] = known + line.lines().count { it.isNotBlank() }
    }

    /** Appends [lines] to [rejected], then deletes [pending]. */
    @Synchronized
    fun keepRejected(pending: File, rejected: File, lines: List<String>) {
        lines.forEach { appendLine(rejected, it) }
        lineCounts.remove(pending)
        if (pending.delete()) lineCounts[pending] = 0
    }

    /**
     * Appends [bytes] to [file] and returns once they are on storage, so a power cut afterwards
     * keeps them. A power cut during the call can leave a torn last line, which [parseLog] rejects.
     */
    private fun appendDurably(file: File, bytes: ByteArray) {
        FileOutputStream(file, true).use {
            it.write(bytes)
            it.fd.sync()
        }
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
        val moved = lineCounts.remove(log)
        val kept = lineCounts.remove(pending)
        if (log.exists()) {
            if (!pending.exists()) {
                check(log.renameTo(pending)) { "Could not rename the log to the pending file" }
            } else {
                appendDurably(pending, startOfLine(pending).toByteArray() + log.readBytes())
                log.delete()
            }
        }
        if (!log.exists()) lineCounts[log] = 0
        if (moved != null && kept != null) lineCounts[pending] = moved + kept
        return pending.takeIf { it.exists() && it.length() > 0 }
    }
}
