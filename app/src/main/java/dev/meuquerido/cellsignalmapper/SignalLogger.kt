package dev.meuquerido.cellsignalmapper

import android.content.Context
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import java.io.File
import java.io.FileWriter

object SignalLogger {
    private val gson: Gson = GsonBuilder().create()
    private const val LOG_FILE_NAME = "signal_log.json"

    fun logEntry(context: Context, entry: SignalLogEntry) {
        val file = File(context.filesDir, LOG_FILE_NAME)
        val writer = FileWriter(file, true)
        writer.appendLine(gson.toJson(entry))
        writer.close()
    }

    fun getLogFile(context: Context): File {
        return File(context.filesDir, LOG_FILE_NAME)
    }
}
