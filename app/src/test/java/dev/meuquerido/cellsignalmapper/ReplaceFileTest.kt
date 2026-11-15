package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class ReplaceFileTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val file: File get() = File(dir.root, "copy.json")

    @Test
    fun replacesTheEarlierContent() {
        file.writeText("earlier\n")

        SignalLogger.replaceFile(file, "later\n")

        assertEquals("later\n", file.readText())
    }

    @Test
    fun failedWriteLeavesTheEarlierContentReadable() {
        file.writeText("earlier\n")
        File(dir.root, "copy.json.tmp").mkdir()

        assertThrows(IOException::class.java) { SignalLogger.replaceFile(file, "later\n") }

        assertEquals("earlier\n", file.readText())
    }
}
