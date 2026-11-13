package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeoutException
import kotlin.concurrent.thread

class SignalLoggerPendingTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val log: File get() = File(dir.root, "log.json")
    private val pending: File get() = File(dir.root, "pending.json")
    private val rejected: File get() = File(dir.root, "rejected.json")
    private val gson = Gson()

    private fun sample(id: String) = gson.toJson(testSample(id))

    /** The non-blank lines in the log and the pending file, read from disk. */
    private fun fullCount(): Int =
        listOf(log, pending).filter { it.exists() }.sumOf { f -> f.readLines().count { it.isNotBlank() } }

    private fun assertCountMatchesFiles() = synchronized(SignalLogger) {
        assertEquals(fullCount(), SignalLogger.pendingCount(log, pending))
    }

    @Test
    fun samplesAppendedDuringAnUploadAreNotDeleted() {
        SignalLogger.appendLine(log, "sample 1")
        SignalLogger.appendLine(log, "sample 2")

        val toUpload = SignalLogger.takePending(log, pending)!!
        SignalLogger.appendLine(log, "sample 3")
        assertEquals(listOf("sample 1", "sample 2"), toUpload.readLines())
        toUpload.delete()

        assertEquals(listOf("sample 3"), log.readLines())
    }

    @Test
    fun failedUploadKeepsItsSamplesForTheNextOne() {
        SignalLogger.appendLine(log, "sample 1")
        SignalLogger.takePending(log, pending)
        SignalLogger.appendLine(log, "sample 2")

        val toUpload = SignalLogger.takePending(log, pending)!!

        assertEquals(listOf("sample 1", "sample 2"), toUpload.readLines())
        assertFalse(log.exists())
    }

    @Test
    fun failedMoveThrowsAndKeepsTheLog() {
        SignalLogger.appendLine(log, "sample 1")
        val unreachable = File(dir.root, "missing-dir/pending.json")

        assertThrows(IllegalStateException::class.java) { SignalLogger.takePending(log, unreachable) }
        assertEquals(listOf("sample 1"), log.readLines())
    }

    @Test
    fun failedAppendToPendingThrowsAndKeepsTheLog() {
        SignalLogger.appendLine(log, "sample 1")
        pending.mkdir()

        assertThrows(IOException::class.java) { SignalLogger.takePending(log, pending) }
        assertEquals(listOf("sample 1"), log.readLines())
    }

    @Test
    fun nothingToUpload() {
        assertNull(SignalLogger.takePending(log, pending))
    }

    @Test
    fun noSampleIsLostWhileLoggingRunsDuringUploads() {
        val count = 2000
        val writer = thread { repeat(count) { SignalLogger.appendLine(log, "sample $it") } }
        val uploaded = mutableListOf<String>()
        while (writer.isAlive) {
            SignalLogger.takePending(log, pending)?.let {
                uploaded += it.readLines()
                it.delete()
            }
        }
        writer.join()
        SignalLogger.takePending(log, pending)?.let { uploaded += it.readLines() }

        assertEquals((0 until count).map { "sample $it" }, uploaded)
    }

    @Test
    fun pendingCountAddsNonBlankLinesOfBothFiles() {
        SignalLogger.appendLine(log, "sample 1")
        SignalLogger.takePending(log, pending)
        SignalLogger.appendLine(log, "sample 2")
        SignalLogger.appendLine(log, "")
        SignalLogger.appendLine(log, "sample 3")

        assertEquals(3, SignalLogger.pendingCount(log, pending))
    }

    @Test
    fun pendingCountIsZeroWithoutFiles() {
        assertEquals(0, SignalLogger.pendingCount(log, pending))
    }

    @Test
    fun pendingCountNeverCountsALineTwiceWhileItMoves() {
        val count = 500
        val writer = thread {
            repeat(count) {
                SignalLogger.appendLine(log, "sample $it")
                SignalLogger.takePending(log, pending)
            }
        }
        val counts = mutableListOf<Int>()
        while (writer.isAlive) counts += SignalLogger.pendingCount(log, pending)
        writer.join()
        counts += SignalLogger.pendingCount(log, pending)

        assertEquals(counts.sorted(), counts)
        assertEquals(count, counts.last())
    }

    @Test
    fun countOverAnUnreadableFileFailsWithoutThrowing() {
        SignalLogger.appendLine(log, "sample 1")
        pending.mkdir()

        assertTrue(SignalLogger.countPending(log, pending).exceptionOrNull() is IOException)
    }

    @Test
    fun countOfReadableFilesSucceeds() {
        SignalLogger.appendLine(log, "sample 1")

        assertEquals(1, SignalLogger.countPending(log, pending).getOrThrow())
    }

    @Test
    fun countAfterAnAppendDoesNotRereadTheLog() {
        SignalLogger.appendLine(log, "sample 1")
        assertEquals(1, SignalLogger.pendingCount(log, pending))
        log.appendText("written behind the logger's back\n")
        SignalLogger.appendLine(log, "sample 2")

        assertEquals(2, SignalLogger.pendingCount(log, pending))
    }

    @Test
    fun keptCountMatchesTheFilesThroughUploads() {
        log.writeText("torn line without newline")
        assertCountMatchesFiles()
        SignalLogger.appendLine(log, sample("a"))
        SignalLogger.appendLine(log, "")
        SignalLogger.appendLine(log, "not a sample")
        assertCountMatchesFiles()

        SignalLogger.takePending(log, pending)
        assertCountMatchesFiles()
        SignalLogger.appendLine(log, sample("b"))
        assertThrows(TimeoutException::class.java) {
            uploadPending(pending, rejected, gson) { throw TimeoutException() }
        }
        assertCountMatchesFiles()

        SignalLogger.takePending(log, pending)
        SignalLogger.appendLine(log, sample("c"))
        uploadPending(pending, rejected, gson) {}
        assertCountMatchesFiles()
        assertEquals(1, SignalLogger.pendingCount(log, pending))
    }

    @Test
    fun keptCountMatchesTheFilesWhileLoggingRunsDuringUploads() {
        assertCountMatchesFiles()
        val writer = thread { repeat(2000) { SignalLogger.appendLine(log, sample("s$it")) } }
        var attempt = 0
        while (writer.isAlive) {
            SignalLogger.takePending(log, pending)?.let { toUpload ->
                if (attempt++ % 2 == 0) {
                    runCatching { uploadPending(toUpload, rejected, gson) { throw TimeoutException() } }
                } else {
                    uploadPending(toUpload, rejected, gson) {}
                }
            }
            assertCountMatchesFiles()
        }
        writer.join()

        assertCountMatchesFiles()
    }

    @Test
    fun failedMoveLeavesTheCountMatchingTheFiles() {
        SignalLogger.appendLine(log, "sample 1")
        assertCountMatchesFiles()
        pending.mkdir()
        assertThrows(IOException::class.java) { SignalLogger.takePending(log, pending) }
        pending.delete()

        assertCountMatchesFiles()
    }

    @Test
    fun keptCountMatchesCrlfFilesThroughUploads() {
        val logBytes = "${sample("a")}\r\n\r\ntorn line\r".toByteArray()
        val pendingBytes = "${sample("p")}\r\nnot a sample\r".toByteArray()
        log.writeBytes(logBytes)
        pending.writeBytes(pendingBytes)
        assertCountMatchesFiles()

        SignalLogger.appendLine(log, sample("b"))
        assertCountMatchesFiles()
        assertTrue(log.readBytes().startsWith(logBytes))

        val movedLog = log.readBytes()
        SignalLogger.takePending(log, pending)
        assertCountMatchesFiles()
        val taken = pending.readBytes()
        assertTrue(taken.startsWith(pendingBytes))
        assertTrue(taken.endsWith(movedLog))

        assertThrows(TimeoutException::class.java) {
            uploadPending(pending, rejected, gson) { throw TimeoutException() }
        }
        assertCountMatchesFiles()
        assertTrue(pending.readBytes().contentEquals(taken))

        uploadPending(pending, rejected, gson) {}
        assertCountMatchesFiles()
        assertEquals(0, SignalLogger.pendingCount(log, pending))
    }

    private fun ByteArray.startsWith(prefix: ByteArray) =
        size >= prefix.size && copyOfRange(0, prefix.size).contentEquals(prefix)

    private fun ByteArray.endsWith(suffix: ByteArray) =
        size >= suffix.size && copyOfRange(size - suffix.size, size).contentEquals(suffix)
}
