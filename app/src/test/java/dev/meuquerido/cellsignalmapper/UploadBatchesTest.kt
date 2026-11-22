package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadBatchesTest {
    private val gson = Gson()

    @Test
    fun splitsIntoBatchesOfAtMost500InOrder() {
        val lines = (1..1201).map { "line $it" }

        val batches = uploadBatches(lines) { 1 }

        assertEquals(listOf(500, 500, 201), batches.map { it.size })
        assertEquals(lines, batches.flatten())
    }

    @Test
    fun noLinesGiveNoBatches() {
        assertEquals(emptyList<List<String>>(), uploadBatches(emptyList<String>()) { 1 })
    }

    @Test
    fun startsANewBatchWhenTheNextItemWouldPassTheBodyLimit() {
        val third = (UPLOAD_BODY_LIMIT_BYTES - UPLOAD_BODY_FRAME_BYTES - 2) / 3
        // With two commas and the frame, three items of these sizes take exactly the limit.
        val fill = UPLOAD_BODY_LIMIT_BYTES - UPLOAD_BODY_FRAME_BYTES - 2 - 2 * third

        assertEquals(listOf(listOf(third, third, fill), listOf(1)), uploadBatches(listOf(third, third, fill, 1)) { it })
        assertEquals(listOf(listOf(third, third), listOf(fill + 1)), uploadBatches(listOf(third, third, fill + 1)) { it })
    }

    @Test
    fun anItemTooLargeForABodyGetsABatchOfItsOwn() {
        val items = listOf(10, UPLOAD_BODY_LIMIT_BYTES, 10)

        assertEquals(listOf(listOf(10), listOf(UPLOAD_BODY_LIMIT_BYTES), listOf(10)), uploadBatches(items) { it })
    }

    @Test
    fun largeSamplesAreSplitIntoUploadBodiesThatEachFit() {
        // About 6 KB a sample, like a phone hearing 40 LTE cells: a full batch would take 3 MB.
        val samples = (1..2 * UPLOAD_BATCH_LIMIT).map { testSample("s$it", cells = 40) }
        assertTrue(uploadBody(samples.take(UPLOAD_BATCH_LIMIT), gson).toByteArray().size > UPLOAD_BODY_LIMIT_BYTES)

        val batches = uploadBatches(samples) { sampleBytes(it, gson) }

        assertEquals(samples, batches.flatten())
        assertTrue(batches.size > 2)
        for (batch in batches) {
            val body = uploadBody(batch, gson).toByteArray().size
            assertEquals(UPLOAD_BODY_FRAME_BYTES + batch.sumOf { sampleBytes(it, gson) } + batch.size - 1, body)
            assertTrue("$body bytes", body <= UPLOAD_BODY_LIMIT_BYTES)
        }
    }
}
