package dev.meuquerido.cellsignalmapper

import android.content.Context
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import java.io.File
import java.io.IOException

/** The file in `Context.getFilesDir()` that lists the recordings sent from this phone. */
const val RECORDINGS_FILE_NAME = "recordings.json"

/**
 * A recording the server took samples of: its session id, its first sample's time, how many of its
 * samples uploads from this phone counted as taken, and how many the server last listed.
 */
data class Recording(
    val sessionId: String,
    val startMs: Long,
    @SerializedName("samples") val sent: Int,
    val listed: Int,
) {
    /**
     * How many samples the server took. The server stores a sample once by its id, so the two
     * counts overlap and are never added: [listed] misses samples taken after the server listed
     * them and [sent] misses samples sent before this phone kept the list.
     */
    val samples: Int get() = maxOf(sent, listed)
}

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
            (known?.sent ?: 0) + samples.size,
            known?.listed ?: 0,
        )
    }
    return list.copy(recordings = bySession.values.toList())
}

/**
 * [list] with each recording in [listed], which the server holds, added, or merged into the
 * recording of its session, which takes the earlier start and the server's count as its
 * [Recording.listed]; recordings of a deleted session are left out.
 */
fun withListed(list: RecordingList, listed: List<Recording>): RecordingList {
    val bySession = list.recordings.associateBy { it.sessionId }.toMutableMap()
    for (recording in listed.filter { it.sessionId !in list.deleted }.distinctBy { it.sessionId }) {
        val known = bySession[recording.sessionId]
        bySession[recording.sessionId] =
            known?.copy(startMs = minOf(known.startMs, recording.startMs), listed = recording.listed) ?: recording
    }
    return list.copy(recordings = bySession.values.toList())
}

/** One session in the list function's answer: its id, its first sample's time and how many raw samples it holds. */
private data class ListedSession(val sessionId: String, val startMs: Long, val samples: Int)

/** The list function's answer: the sessions it holds raw samples of. */
private data class ListAnswer(val sessions: List<ListedSession?>?)

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
    return sessions.filterNotNull().filter { it.sessionId != null }.map { Recording(it.sessionId, it.startMs, 0, it.samples) }
}

/** What came of asking the server to delete a recording. */
enum class DeleteResult {
    /** The server deleted the recording, now or before. */
    DELETED,

    /**
     * The server holds nothing of the recording with this phone's install id: its samples expired
     * and none of them reached the map, or it was sent with an install id from before the app was
     * reinstalled. Nothing was deleted, and asking again won't change that.
     */
    NOT_STORED,

    /** The server couldn't be reached or failed; asking again may work. */
    FAILED,
}

/** The [DeleteResult] of the delete function's answer with HTTP [status]. */
fun deleteResult(status: Int): DeleteResult =
    when (status) {
        in 200..299 -> DeleteResult.DELETED
        404 -> DeleteResult.NOT_STORED
        else -> DeleteResult.FAILED
    }

/**
 * [list] after asking the server to delete the recording of [sessionId] came to [result]. A
 * recording the server deleted leaves the list and is never listed again. One it holds nothing of
 * leaves the list too, since no Delete of it can succeed, but comes back if more of its samples are
 * sent or the server lists it. After a failure the list is unchanged.
 */
fun afterDelete(list: RecordingList, sessionId: String, result: DeleteResult): RecordingList {
    val others = list.recordings.filter { it.sessionId != sessionId }
    return when (result) {
        DeleteResult.DELETED -> RecordingList(others, (list.deleted + sessionId).distinct())
        DeleteResult.NOT_STORED -> list.copy(recordings = others)
        DeleteResult.FAILED -> list
    }
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

    /** Changes the list as [afterDelete] does. Throws [IOException] when the list can't be written. */
    @Synchronized
    fun afterDelete(context: Context, sessionId: String, result: DeleteResult) =
        update(context) { afterDelete(it, sessionId, result) }

    private fun update(context: Context, change: (RecordingList) -> RecordingList) {
        val file = file(context)
        replaceFile(file, gson.toJson(change(readRecordings(file, gson))))
    }
}
