package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class BackupRulesTest {
    // Unit tests run in the module's directory.
    private val rules = File("src/main/res/xml")

    /** The `file` paths excluded under each element named [section] of the rule file [name], one set per element. */
    private fun excludedFiles(name: String, section: String): List<Set<String>> {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(rules, name))
        val sections = document.getElementsByTagName(section)
        return (0 until sections.length).map { i ->
            val excludes = (sections.item(i) as Element).getElementsByTagName("exclude")
            (0 until excludes.length).map { excludes.item(it) as Element }
                .filter { it.getAttribute("domain") == "file" }
                .map { it.getAttribute("path") }
                .toSet()
        }
    }

    /** The excluded files of every rule set: Auto Backup, cloud backup and device transfer. */
    private val excluded = excludedFiles("backup_rules.xml", "full-backup-content") +
        excludedFiles("data_extraction_rules.xml", "cloud-backup") +
        excludedFiles("data_extraction_rules.xml", "device-transfer")

    @Test
    fun theRecordingsListAndItsTemporaryFileAreNeitherBackedUpNorTransferred() {
        assertEquals(3, excluded.size)
        for (files in excluded) {
            assertTrue(files.containsAll(listOf(RECORDINGS_FILE_NAME, "$RECORDINGS_FILE_NAME.tmp")))
        }
    }

    @Test
    fun everyRuleSetExcludesTheSameFiles() {
        assertEquals(1, excluded.distinct().size)
    }
}
