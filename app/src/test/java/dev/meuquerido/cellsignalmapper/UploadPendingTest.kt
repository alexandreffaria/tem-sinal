package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.TimeoutException

class UploadPendingTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val gson = Gson()
    private val pending: File get() = File(dir.root, "pending.json")
    private val rejected: File get() = File(dir.root, "rejected.json")

    private fun sample(id: String) = SignalLogEntry(
        id = id,
        timestamp = 1_000L,
        latitude = null,
        longitude = null,
        signalDbm = -90,
        carrier = "Test Carrier",
        mcc = "001",
        mnc = "01",
        cellInfo = "test"
    )

    private fun writePending(lines: List<String>) = lines.forEach { SignalLogger.appendLine(pending, it) }

    @Test
    fun timedOutCommitKeepsThePendingFile() {
        writePending(listOf(gson.toJson(sample("a")), "not a sample", gson.toJson(sample("b"))))
        val before = pending.readLines()

        assertThrows(TimeoutException::class.java) {
            uploadPending(pending, rejected, gson) { throw TimeoutException() }
        }

        assertEquals(before, pending.readLines())
        assertFalse(rejected.exists())
    }

    @Test
    fun timeoutOnALaterBatchKeepsEverySample() {
        val lines = (1..FIRESTORE_BATCH_LIMIT + 1).map { gson.toJson(sample("s$it")) }
        writePending(lines)
        var commits = 0

        assertThrows(TimeoutException::class.java) {
            uploadPending(pending, rejected, gson) { if (++commits == 2) throw TimeoutException() }
        }

        assertEquals(lines, pending.readLines())
    }

    @Test
    fun committedUploadDeletesThePendingFileAndKeepsRejectedLines() {
        writePending(listOf(gson.toJson(sample("a")), "not a sample"))
        val committed = mutableListOf<String>()

        uploadPending(pending, rejected, gson) { batch -> committed += batch.map { it.id } }

        assertEquals(listOf("a"), committed)
        assertFalse(pending.exists())
        assertEquals(listOf("not a sample"), rejected.readLines())
    }
}
