package dev.meuquerido.cellsignalmapper

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.gson.Gson
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Firestore rejects a write batch with more than this many operations. */
const val FIRESTORE_BATCH_LIMIT = 500

/** Splits [items] into consecutive batches of at most [FIRESTORE_BATCH_LIMIT], in order. */
fun <T> uploadBatches(items: List<T>): List<List<T>> = items.chunked(FIRESTORE_BATCH_LIMIT)

/**
 * The samples in a log, in order, and the non-blank lines that are not a sample of
 * [SAMPLE_SCHEMA_VERSION] with an id.
 */
data class ParsedLog(val samples: List<Sample>, val rejected: List<String>)

/**
 * Parses each non-blank line of [lines] as a [Sample]; blank lines are skipped. A line of any other
 * schema version, such as a version 1 line, is rejected and never uploaded.
 */
fun parseLog(lines: List<String>, gson: Gson): ParsedLog {
    val samples = mutableListOf<Sample>()
    val rejected = mutableListOf<String>()
    for (line in lines.filter { it.isNotBlank() }) {
        val sample = try {
            gson.fromJson(line, Sample::class.java)
        } catch (e: RuntimeException) {
            null
        }
        // Gson leaves a missing id null despite the declared type.
        if (sample != null && sample.schemaVersion == SAMPLE_SCHEMA_VERSION && !sample.id.isNullOrEmpty()) {
            samples += sample
        } else {
            rejected += line
        }
    }
    return ParsedLog(samples, rejected)
}

/**
 * How long one batch commit may wait for the server. Firestore completes a commit only when the
 * server acknowledges it, so offline the wait would otherwise last until the network returns.
 */
const val COMMIT_TIMEOUT_SECONDS = 30L

/** How long an anonymous sign-in may wait for the server. */
const val SIGN_IN_TIMEOUT_SECONDS = 30L

/**
 * Commits the samples in [pending] batch by batch with [commit], then moves the lines that are not
 * a sample to [rejected] and deletes [pending]. If [commit] throws, for example on a timeout, the
 * exception propagates and both files are left as they were.
 */
fun uploadPending(pending: File, rejected: File, gson: Gson, commit: (List<Sample>) -> Unit): ParsedLog {
    val log = parseLog(pending.readLines(), gson)
    uploadBatches(log.samples).forEach(commit)
    SignalLogger.keepRejected(pending, rejected, log.rejected)
    return log
}

object FirebaseUploader {
    @SuppressLint("StaticFieldLeak")
    private val db = FirebaseFirestore.getInstance()
    private val gson = Gson()
    private val uploadLock = Mutex()

    /**
     * Uploads every logged sample off the main thread, one upload at a time, publishes the pending
     * count, and returns whether the upload succeeded. The pending file is deleted only after every
     * batch was committed; a failed or timed-out upload keeps it for the next attempt, and samples
     * logged meanwhile stay in the log. Re-uploading a batch is harmless because each document id
     * is the sample's id, so a timed-out write that Firestore still delivers later only rewrites
     * the same documents.
     */
    suspend fun uploadLogFile(context: Context): Boolean = withContext(Dispatchers.IO) {
        val result = uploadLock.withLock { upload(context) }
        SignalLogger.publishPendingCount(context)
        result
    }

    /**
     * Returns false, keeping the log and the pending file, if moving, reading, signing in or any
     * batch fails, or sign-in or a batch is not acknowledged within its timeout. Signs in
     * anonymously first when no user is signed in. Lines that are not a sample are moved to the
     * rejected file instead of being deleted.
     */
    private fun upload(context: Context): Boolean {
        try {
            val pending = SignalLogger.takePending(
                SignalLogger.getLogFile(context),
                SignalLogger.getPendingFile(context)
            )
            if (pending == null) {
                Log.d("FirebaseUploader", "Nothing to upload.")
                return false
            }

            val auth = FirebaseAuth.getInstance()
            if (auth.currentUser == null) {
                Tasks.await(auth.signInAnonymously(), SIGN_IN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            }
            val collection = db.collection("signal_logs")
            val log = uploadPending(pending, SignalLogger.getRejectedFile(context), gson) { samples ->
                val batch = db.batch()
                samples.forEach { batch.set(collection.document(it.id), it) }
                Tasks.await(batch.commit(), COMMIT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            }
            if (log.rejected.isNotEmpty()) {
                Log.w("FirebaseUploader", "Kept ${log.rejected.size} unparseable lines in the rejected file.")
            }
            Log.d("FirebaseUploader", "Upload successful, pending file deleted.")
            return true
        } catch (e: Exception) {
            Log.e("FirebaseUploader", "Upload failed", e)
            return false
        }
    }
}
