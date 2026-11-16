package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class RecordingsTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val gson = Gson()
    private val empty = RecordingList(emptyList(), emptyList())

    // Made-up session ids.
    private val first = "5d0c8a1e-7b3f-4e2a-9c6d-1f8b2a4e6c90"
    private val second = "a2e94f6b-0c1d-4b7e-8f3a-6d5c9e1b2a47"

    private fun sent(sessionId: String, timeMs: Long, count: Int) =
        (1..count).map { testSample("$sessionId-$it").copy(sessionId = sessionId, timeMs = timeMs + it) }

    @Test
    fun samplesSentInSeveralUploadsAddUpUnderTheirRecordingFromItsFirstSample() {
        val list = withSent(withSent(empty, sent(first, 5_000L, 3) + sent(second, 9_000L, 1)), sent(first, 1_000L, 2))

        assertEquals(
            listOf(Recording(second, 9_001L, 1, 0), Recording(first, 1_001L, 5, 0)),
            newestFirst(list),
        )
    }

    @Test
    fun aDeletedRecordingIsNeverListedAgainEvenWhenItsSamplesAreSentLater() {
        val list = withDeleted(withSent(empty, sent(first, 1_000L, 2) + sent(second, 2_000L, 1)), first)

        assertEquals(listOf(Recording(second, 2_001L, 1, 0)), newestFirst(withSent(list, sent(first, 3_000L, 4))))
    }

    @Test
    fun theListSurvivesBeingWrittenAndRead() {
        val file = File(dir.root, RECORDINGS_FILE_NAME)
        val list = withDeleted(withSent(empty, sent(first, 1_000L, 2) + sent(second, 2_000L, 1)), second)
        replaceFile(file, gson.toJson(list))

        assertEquals(list, readRecordings(file, gson))
    }

    @Test
    fun aMissingOrUnreadableFileIsAnEmptyList() {
        val file = File(dir.root, RECORDINGS_FILE_NAME)
        assertEquals(empty, readRecordings(file, gson))
        file.writeText("{\"recordings\": [")
        assertEquals(empty, readRecordings(file, gson))
        file.writeText("{\"recordings\": [{\"startMs\": 1}]}")
        assertEquals(empty, readRecordings(file, gson))
    }

    @Test
    fun recordingsTheServerListsAreAddedOrMergedUnlessDeleted() {
        val third = "e6b1d3a8-2f4c-4d9e-a7b0-3c5e8f1d2a69"
        val list = withDeleted(withSent(empty, sent(first, 1_000L, 5) + sent(third, 4_000L, 1)), third)
        val listed = listOf(Recording(first, 900L, 0, 3), Recording(second, 2_000L, 0, 7), Recording(third, 4_001L, 0, 1))

        val merged = withListed(list, listed)

        assertEquals(listOf(Recording(second, 2_000L, 0, 7), Recording(first, 900L, 5, 3)), newestFirst(merged))
        assertEquals(listOf(7, 5), newestFirst(merged).map { it.samples })
        assertEquals(merged, withListed(merged, listed))
    }

    @Test
    fun aRecordingListedWhileItsUploadIsInFlightIsNotCountedTwice() {
        val samples = sent(first, 1_000L, 4)
        val listedMidUpload = withListed(empty, listOf(Recording(first, 1_001L, 0, 2)))
        val listedAfterUpload = withListed(withSent(empty, samples), listOf(Recording(first, 1_001L, 0, 4)))

        assertEquals(listOf(4), withSent(listedMidUpload, samples).recordings.map { it.samples })
        assertEquals(listOf(4), withSent(withListed(listedMidUpload, listOf(Recording(first, 1_001L, 0, 4))), samples).recordings.map { it.samples })
        assertEquals(listOf(4), listedAfterUpload.recordings.map { it.samples })
    }

    @Test
    fun theListFunctionsAnswerIsReadAndAFailedOneThrows() {
        val body = "{\"sessions\": [{\"sessionId\": \"$first\", \"startMs\": 1000, \"samples\": 4}, {\"startMs\": 2}]}"
        assertEquals(listOf(Recording(first, 1_000L, 0, 4)), listedRecordings(200, body, gson))
        for ((status, failed) in listOf(500 to body, 200 to "{}", 200 to "not json")) {
            assertThrows(IOException::class.java) { listedRecordings(status, failed, gson) }
        }
    }

    @Test
    fun onlyASuccessfulAnswerCountsAsDeletedAndNotFoundIsNothingStoredFromThisInstall() {
        assertEquals(DeleteResult.DELETED, deleteResult(204))
        assertEquals(DeleteResult.NOT_STORED, deleteResult(404))
        for (status in listOf(400, 401, 500, 503)) assertEquals(DeleteResult.FAILED, deleteResult(status))
    }
}
