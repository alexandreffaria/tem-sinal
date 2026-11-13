package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class TornLineTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val gson = Gson()
    private val log: File get() = File(dir.root, "log.json")
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

    private fun torn(id: String) = gson.toJson(sample(id)).take(20)

    @Test
    fun sampleAfterATornLineIsStillUploaded() {
        SignalLogger.appendLine(log, gson.toJson(sample("a")))
        log.appendText(torn("b"))
        SignalLogger.appendLine(log, gson.toJson(sample("c")))

        val parsed = parseLog(SignalLogger.takePending(log, pending)!!.readLines(), gson)

        assertEquals(listOf(sample("a"), sample("c")), parsed.samples)
        assertEquals(listOf(torn("b")), parsed.rejected)
    }

    @Test
    fun logMovedAfterATornPendingFileStartsOnItsOwnLine() {
        pending.writeText(torn("a"))
        SignalLogger.appendLine(log, gson.toJson(sample("b")))

        val parsed = parseLog(SignalLogger.takePending(log, pending)!!.readLines(), gson)

        assertEquals(listOf(sample("b")), parsed.samples)
    }

    @Test
    fun unparseableLinesAreKeptWhenThePendingFileIsDeleted() {
        SignalLogger.appendLine(log, "not json")
        SignalLogger.appendLine(log, "")
        SignalLogger.appendLine(log, "{\"timestamp\":1}")
        SignalLogger.appendLine(log, gson.toJson(sample("a")))
        val toUpload = SignalLogger.takePending(log, pending)!!

        val parsed = parseLog(toUpload.readLines(), gson)
        SignalLogger.keepRejected(toUpload, rejected, parsed.rejected)

        assertEquals(listOf(sample("a")), parsed.samples)
        assertEquals(listOf("not json", "{\"timestamp\":1}"), rejected.readLines())
        assertFalse(pending.exists())
    }
}
