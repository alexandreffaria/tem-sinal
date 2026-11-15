package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class FirstLogWarningTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val file: File get() = File(dir.root, FIRST_LOG_WARNING_FILE_NAME)

    @Test
    fun warnsOnlyUntilShownOnce() {
        assertTrue(firstLogWarningDue(file))

        markFirstLogWarningShown(file)

        assertFalse(firstLogWarningDue(file))
        markFirstLogWarningShown(file)
        assertFalse(firstLogWarningDue(file))
    }
}
