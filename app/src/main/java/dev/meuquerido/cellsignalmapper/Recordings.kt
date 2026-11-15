package dev.meuquerido.cellsignalmapper

import android.content.Context
import com.google.gson.Gson
import java.io.File
import java.io.IOException

/** The file in `Context.getFilesDir()` that lists the recordings sent from this phone. */
const val RECORDINGS_FILE_NAME = "recordings.json"

/** A recording the server took samples of: its session id, its first sample's time and how many it took. */
data class Recording(val sessionId: String, val startMs: Long, val samples: Int)

/**
 * The recordings sent from this phone, and the session ids of those deleted, which are never
 * listed again. Holds no coordinates.
 */
data class RecordingList(val recordings: List<Recording>, val deleted: List<String>)

/**
 * [list] with [sent], samples the server took, added to the recording of their session, or as a
 * new one; samples of a deleted session are left out.
 */
fun withSent(list: RecordingList, sent: List<Sample>): RecordingList {
    val bySession = list.recordings.associateBy { it.sessionId }.toMutableMap()
    for ((sessionId, samples) in sent.filter { it.sessionId !in list.deleted }.groupBy { it.sessionId }) {
        val startMs = samples.minOf { it.timeMs }
        val known = bySession[sessionId]
        bySession[sessionId] = Recording(
            sessionId,
            minOf(startMs, known?.startMs ?: startMs),
            (known?.samples ?: 0) + samples.size,
        )
    }
    return list.copy(recordings = bySession.values.toList())
}

/** [list] without the recording of [sessionId], which is never listed again. */
fun withDeleted(list: RecordingList, sessionId: String): RecordingList =
    RecordingList(list.recordings.filter { it.sessionId != sessionId }, (list.deleted + sessionId).distinct())

/**
 * [list] with each recording in [listed], which the server holds, added unless its session is
 * already listed or was deleted; a listed recording keeps its own figures.
 */
fun withListed(list: RecordingList, listed: List<Recording>): RecordingList {
    val known = list.recordings.map { it.sessionId }.toSet() + list.deleted
    return list.copy(recordings = list.recordings + listed.filter { it.sessionId !in known }.distinctBy { it.sessionId })
}

/** The list function's answer: the recordings it holds raw samples of. */
private data class ListAnswer(val sessions: List<Recording?>?)

/**
 * The recordings in the list function's answer, HTTP [status] and the response [body]. Throws
 * [IOException] when the answer isn't a 2xx with a list. Gson leaves missing fields null despite
 * the declared types, so entries without a session id are skipped.
 */
fun listedRecordings(status: Int, body: String, gson: Gson): List<Recording> {
    if (status !in 200..299) throw IOException("List function answered HTTP $status")
    val answer = try {
        gson.fromJson(body, ListAnswer::class.java)
    } catch (e: RuntimeException) {
        null
    }
    val sessions = answer?.sessions ?: throw IOException("List function's answer has no list")
    @Suppress("SENSELESS_COMPARISON")
    return sessions.filterNotNull().filter { it.sessionId != null }
}

/** The recordings in [list], newest first. */
fun newestFirst(list: RecordingList): List<Recording> = list.recordings.sortedByDescending { it.startMs }

/**
 * The list in [file], empty when [file] is missing or doesn't hold one. Gson leaves missing fields
 * null despite the declared types, so entries without them are skipped.
 */
fun readRecordings(file: File, gson: Gson): RecordingList {
    val read = try {
        if (file.exists()) gson.fromJson(file.readText(), RecordingList::class.java) else null
    } catch (e: RuntimeException) {
        null
    }
    @Suppress("SENSELESS_COMPARISON", "USELESS_ELVIS")
    return RecordingList(
        (read?.recordings ?: emptyList()).filter { it != null && it.sessionId != null },
        (read?.deleted ?: emptyList()).filterNotNull(),
    )
}

/** The list of recordings sent from this phone, kept in [RECORDINGS_FILE_NAME]. Reads and writes a file: not for the main thread. */
object Recordings {
    private val gson = Gson()

    private fun file(context: Context) = File(context.filesDir, RECORDINGS_FILE_NAME)

    fun list(context: Context): List<Recording> = newestFirst(readRecordings(file(context), gson))

    /** Adds [sent] as [withSent] does. Throws [IOException] when the list can't be written. */
    @Synchronized
    fun addSent(context: Context, sent: List<Sample>) = update(context) { withSent(it, sent) }

    /** Adds [listed] as [withListed] does. Throws [IOException] when the list can't be written. */
    @Synchronized
    fun addListed(context: Context, listed: List<Recording>) = update(context) { withListed(it, listed) }

    /** Removes [sessionId] as [withDeleted] does. Throws [IOException] when the list can't be written. */
    @Synchronized
    fun markDeleted(context: Context, sessionId: String) = update(context) { withDeleted(it, sessionId) }

    private fun update(context: Context, change: (RecordingList) -> RecordingList) {
        val file = file(context)
        replaceFile(file, gson.toJson(change(readRecordings(file, gson))))
    }
}
