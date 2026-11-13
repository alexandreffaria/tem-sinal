package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
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
}
