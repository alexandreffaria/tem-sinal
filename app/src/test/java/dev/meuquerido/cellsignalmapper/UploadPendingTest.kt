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

    private fun sample(id: String) = testSample(id)

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
        val lines = (1..UPLOAD_BATCH_LIMIT + 1).map { gson.toJson(sample("s$it")) }
        writePending(lines)
        var commits = 0

        assertThrows(TimeoutException::class.java) {
            uploadPending(pending, rejected, gson) { if (++commits == 2) throw TimeoutException() else emptySet() }
        }

        assertEquals(lines, pending.readLines())
    }

    @Test
    fun committedUploadDeletesThePendingFileAndKeepsRejectedLines() {
        writePending(listOf(gson.toJson(sample("a")), "not a sample"))
        val committed = mutableListOf<String>()

        uploadPending(pending, rejected, gson) { batch -> committed += batch.map { it.id }; emptySet() }

        assertEquals(listOf("a"), committed)
        assertFalse(pending.exists())
        assertEquals(listOf("not a sample"), rejected.readLines())
    }

    @Test
    fun samplesTheServerRejectedGoToTheRejectedFile() {
        val lines = (1..UPLOAD_BATCH_LIMIT + 2).map { gson.toJson(sample("s$it")) }
        writePending(lines)
        var batches = 0

        val uploaded = uploadPending(pending, rejected, gson) { if (++batches == 1) setOf(0) else setOf(1) }

        assertEquals(
            UploadedLog(unparseable = 0, refused = 2, sent = lines.drop(1).dropLast(1).map { gson.fromJson(it, Sample::class.java) }),
            uploaded,
        )
        assertEquals(listOf(lines[0], lines[UPLOAD_BATCH_LIMIT + 1]), rejected.readLines())
        assertFalse(pending.exists())
    }

    @Test
    fun versionOneLineGoesToTheRejectedFileAndIsNeverUploaded() {
        // A made-up line in the version 1 format.
        val v1 = """{"id":"0f6e8f0c-1b2a-3c4d-5e6f-708192a3b4c5","timestamp":1000,""" +
            """"latitude":-15.5,"longitude":-47.5,"signalDbm":-90,"carrier":"Test Carrier",""" +
            """"mcc":"001","mnc":"01","cellInfo":"CI:1, TAC:2, PCI:3"}"""
        val newer = gson.toJson(sample("b").copy(schemaVersion = SAMPLE_SCHEMA_VERSION + 1))
        writePending(listOf(v1, gson.toJson(sample("a")), newer))
        val committed = mutableListOf<Sample>()

        uploadPending(pending, rejected, gson) { batch -> committed += batch; emptySet() }

        assertEquals(listOf(sample("a")), committed)
        assertEquals(listOf(v1, newer), rejected.readLines())
        assertFalse(pending.exists())
    }
}
