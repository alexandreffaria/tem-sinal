package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Test

class UploadBatchesTest {
    @Test
    fun splitsIntoBatchesOfAtMost500InOrder() {
        val lines = (1..1201).map { "line $it" }

        val batches = uploadBatches(lines)

        assertEquals(listOf(500, 500, 201), batches.map { it.size })
        assertEquals(lines, batches.flatten())
    }

    @Test
    fun noLinesGiveNoBatches() {
        assertEquals(emptyList<List<String>>(), uploadBatches(emptyList<String>()))
    }
}
