package dev.meuquerido.cellsignalmapper

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.auth.FirebaseAuth
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonParser
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The most samples the upload function takes in one request. */
const val UPLOAD_BATCH_LIMIT = 500

/** Splits [items] into consecutive batches of at most [UPLOAD_BATCH_LIMIT], in order. */
fun <T> uploadBatches(items: List<T>): List<List<T>> = items.chunked(UPLOAD_BATCH_LIMIT)

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

/** The body the upload function takes for [samples]: `{"samples": [...]}`. */
fun uploadBody(samples: List<Sample>, gson: Gson): String = gson.toJson(mapOf("samples" to samples))

/**
 * [uploadBody] of [samples] indented for reading: the same JSON text, with only whitespace added
 * between tokens, so every name and value appears exactly as it is sent.
 */
fun uploadPreview(samples: List<Sample>, gson: Gson): String =
    GsonBuilder().setPrettyPrinting().create().toJson(JsonParser.parseString(uploadBody(samples, gson)))

/** The upload function, `v1` in `functions/src/index.ts`, at its `/samples` path. */
const val UPLOAD_URL = "https://us-central1-cellsignalmapper-a9da1.cloudfunctions.net/v1/samples"

/** How long connecting to the upload function may take. */
const val CONNECT_TIMEOUT_SECONDS = 15L

/**
 * How long the upload function's answer may take. The function cuts a request off after 30 s;
 * this leaves room for a cold start, so a request that would succeed isn't abandoned and sent
 * again, counting against the server's hourly limit twice.
 */
const val RESPONSE_TIMEOUT_SECONDS = 60L

/** How long an anonymous sign-in, or getting its ID token, may wait for the server. */
const val SIGN_IN_TIMEOUT_SECONDS = 30L

/** How long getting an App Check token may take before the batch is sent without one. */
const val APP_CHECK_TIMEOUT_SECONDS = 10L

/** The upload function's answer to a batch it took; `rejected` gives each refused sample's position. */
private data class UploadAnswer(val accepted: Int?, val rejected: List<RejectedSample>?)

private data class RejectedSample(val index: Int?)

/**
 * The positions in a batch of [batchSize] samples that the upload function rejected, read from its
 * answer: HTTP [status] and the response [body]. Throws [IOException] when the batch as a whole
 * was not taken (any status other than 2xx) or the answer doesn't account for every sample, so
 * the caller keeps the batch. The function counts a sample whose id it already stored as
 * accepted, so a batch sent again is answered as the first time.
 */
fun rejectedIndexes(status: Int, body: String, batchSize: Int, gson: Gson): Set<Int> {
    if (status !in 200..299) throw IOException("Upload function answered HTTP $status")
    val answer = try {
        gson.fromJson(body, UploadAnswer::class.java)
    } catch (e: RuntimeException) {
        null
    }
    // Gson leaves missing fields null despite the declared types.
    val accepted = answer?.accepted
    val listed = answer?.rejected
    val rejected = listed?.mapNotNull { it.index }?.toSet()
    if (accepted == null || listed == null || rejected == null || rejected.size != listed.size ||
        rejected.any { it !in 0 until batchSize } || accepted + rejected.size != batchSize
    ) {
        throw IOException("Upload function's answer doesn't account for the batch")
    }
    return rejected
}

/** How many lines of an uploaded log were not a sample, and how many samples the server rejected. */
data class UploadedLog(val unparseable: Int, val refused: Int)

/**
 * Sends the samples in [pending] batch by batch with [send], which returns the positions in its
 * batch that the server rejected. Then moves the lines that are not a sample, and the samples the
 * server rejected, to [rejected] and deletes [pending]. If [send] throws, for example on a
 * timeout or a refused batch, the exception propagates and both files are left as they were.
 */
fun uploadPending(pending: File, rejected: File, gson: Gson, send: (List<Sample>) -> Set<Int>): UploadedLog {
    val log = parseLog(pending.readLines(), gson)
    val refused = uploadBatches(log.samples).flatMap { batch ->
        val indexes = send(batch)
        batch.filterIndexed { i, _ -> i in indexes }
    }
    SignalLogger.keepRejected(pending, rejected, log.rejected + refused.map { gson.toJson(it) })
    return UploadedLog(log.rejected.size, refused.size)
}

object FirebaseUploader {
    private val gson = Gson()
    private val uploadLock = Mutex()

    init {
        FirebaseAppCheck.getInstance()
            .installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
    }

    /** [uploadPreview] of [samples], with the Gson the upload serialises them with. */
    fun preview(samples: List<Sample>): String = uploadPreview(samples, gson)

    /**
     * Uploads every logged sample off the main thread, one upload at a time, publishes the pending
     * count, and returns whether the upload succeeded. The pending file is deleted only after the
     * server took every batch; a failed or timed-out upload keeps it for the next attempt, and
     * samples logged meanwhile stay in the log. Sending a batch again is harmless because the
     * server stores a sample under its id once.
     */
    suspend fun uploadLogFile(context: Context): Boolean = withContext(Dispatchers.IO) {
        val result = uploadLock.withLock { upload(context) }
        SignalLogger.publishPendingCount(context)
        result
    }

    /**
     * Returns false, keeping the log and the pending file, if moving, reading, signing in or any
     * batch fails, or sign-in or a batch is not answered within its timeout. Signs in
     * anonymously first when no user is signed in. Lines that are not a sample, and samples the
     * server rejected, are moved to the rejected file instead of being deleted.
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
            val user = checkNotNull(auth.currentUser) { "Not signed in" }
            val log = uploadPending(pending, SignalLogger.getRejectedFile(context), gson) { samples ->
                val idToken = Tasks.await(user.getIdToken(false), SIGN_IN_TIMEOUT_SECONDS, TimeUnit.SECONDS).token
                val (status, body) = post(uploadBody(samples, gson), checkNotNull(idToken), appCheckToken())
                rejectedIndexes(status, body, samples.size, gson)
            }
            if (log.unparseable > 0) {
                Log.w("FirebaseUploader", "Kept ${log.unparseable} unparseable lines in the rejected file.")
            }
            if (log.refused > 0) {
                Log.w("FirebaseUploader", "Kept ${log.refused} samples the server rejected in the rejected file.")
            }
            Log.d("FirebaseUploader", "Upload successful, pending file deleted.")
            return true
        } catch (e: Exception) {
            Log.e("FirebaseUploader", "Upload failed", e)
            return false
        }
    }

    /**
     * An App Check token, or null when there is none. The server logs whether a request carries a
     * valid one but doesn't require it, so a batch is sent either way.
     */
    private fun appCheckToken(): String? =
        try {
            Tasks.await(
                FirebaseAppCheck.getInstance().getAppCheckToken(false),
                APP_CHECK_TIMEOUT_SECONDS,
                TimeUnit.SECONDS,
            ).token
        } catch (e: Exception) {
            Log.w("FirebaseUploader", "No App Check token", e)
            null
        }

    /** POSTs [json] to [UPLOAD_URL] and returns the HTTP status and the response body. */
    private fun post(json: String, idToken: String, appCheckToken: String?): Pair<Int, String> {
        val connection = URL(UPLOAD_URL).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TimeUnit.SECONDS.toMillis(CONNECT_TIMEOUT_SECONDS).toInt()
            connection.readTimeout = TimeUnit.SECONDS.toMillis(RESPONSE_TIMEOUT_SECONDS).toInt()
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            // Replaces the default user agent, which names the phone's model and build.
            connection.setRequestProperty("User-Agent", "tem-sinal")
            connection.setRequestProperty("Authorization", "Bearer $idToken")
            appCheckToken?.let { connection.setRequestProperty("X-Firebase-AppCheck", it) }
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            return status to body
        } finally {
            connection.disconnect()
        }
    }
}
