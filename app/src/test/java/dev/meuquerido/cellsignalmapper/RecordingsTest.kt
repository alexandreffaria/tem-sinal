package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

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
            listOf(Recording(second, 9_001L, 1), Recording(first, 1_001L, 5)),
            newestFirst(list),
        )
    }

    @Test
    fun aDeletedRecordingIsNeverListedAgainEvenWhenItsSamplesAreSentLater() {
        val list = withDeleted(withSent(empty, sent(first, 1_000L, 2) + sent(second, 2_000L, 1)), first)

        assertEquals(listOf(Recording(second, 2_001L, 1)), newestFirst(withSent(list, sent(first, 3_000L, 4))))
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
}
