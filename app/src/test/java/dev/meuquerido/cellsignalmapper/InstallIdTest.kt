package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.UUID

class InstallIdTest {
    @get:Rule
    val dir = TemporaryFolder()

    private val file: File get() = File(dir.root, INSTALL_ID_FILE_NAME)

    @Test
    fun firstUseWritesARandomUuidThatLaterUsesRead() {
        val first = installId(file)

        assertEquals(first, UUID.fromString(first).toString())
        assertEquals(first, file.readText())
        assertEquals(first, installId(file))
    }

    @Test
    fun tornIdIsReplacedWithANewUuid() {
        val torn = UUID.randomUUID().toString().take(10)
        file.writeText(torn)

        val id = installId(file)

        assertNotEquals(torn, id)
        assertEquals(id, UUID.fromString(id).toString())
        assertEquals(id, installId(file))
    }
}
