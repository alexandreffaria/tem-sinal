package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import kotlin.concurrent.thread

class SignalLoggerPendingTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val log: File get() = File(dir.root, "log.json")
    private val pending: File get() = File(dir.root, "pending.json")

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
}
