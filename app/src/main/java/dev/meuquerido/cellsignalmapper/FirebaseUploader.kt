package dev.meuquerido.cellsignalmapper

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.FirebaseFirestore
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Firestore rejects a write batch with more than this many operations. */
const val FIRESTORE_BATCH_LIMIT = 500

/** Splits [lines] into consecutive batches of at most [FIRESTORE_BATCH_LIMIT], in order. */
fun uploadBatches(lines: List<String>): List<List<String>> = lines.chunked(FIRESTORE_BATCH_LIMIT)

object FirebaseUploader {
    @SuppressLint("StaticFieldLeak")
    private val db = FirebaseFirestore.getInstance()
    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val uploadLock = Mutex()

    /**
     * Uploads every logged sample off the main thread, one upload at a time, and calls
     * [onComplete] on the main thread. The pending file is deleted only after every batch was
     * committed; a failed upload keeps it for the next attempt, and samples logged meanwhile stay
     * in the log. Re-uploading a batch is harmless because each document id is the sample's id.
     */
    fun uploadLogFile(context: Context, onComplete: (Boolean) -> Unit) {
        val appContext = context.applicationContext
        scope.launch {
            val result = uploadLock.withLock { upload(appContext) }
            withContext(Dispatchers.Main) { onComplete(result) }
        }
    }

    private fun upload(context: Context): Boolean {
        val pending = SignalLogger.takePending(
            SignalLogger.getLogFile(context),
            SignalLogger.getPendingFile(context)
        )
        if (pending == null) {
            Log.d("FirebaseUploader", "Nothing to upload.")
            return false
        }

        val collection = db.collection("signal_logs")
        try {
            for (lines in uploadBatches(pending.readLines().filter { it.isNotBlank() })) {
                val batch = db.batch()
                lines.forEach { line ->
                    try {
                        val entry = gson.fromJson(line, SignalLogEntry::class.java)
                        batch.set(collection.document(entry.id), entry)
                    } catch (e: Exception) {
                        Log.e("FirebaseUploader", "Failed to parse a line", e)
                    }
                }
                Tasks.await(batch.commit())
            }
        } catch (e: Exception) {
            Log.e("FirebaseUploader", "Upload failed", e)
            return false
        }
        Log.d("FirebaseUploader", "Upload successful, deleting pending file.")
        pending.delete()
        return true
    }

    /** Samples not uploaded yet: the log plus a pending file left by a failed upload. */
    fun getPendingLogCount(context: Context): Int =
        listOf(SignalLogger.getLogFile(context), SignalLogger.getPendingFile(context))
            .filter { it.exists() }
            .sumOf { file -> file.readLines().count { it.isNotBlank() } }
}
