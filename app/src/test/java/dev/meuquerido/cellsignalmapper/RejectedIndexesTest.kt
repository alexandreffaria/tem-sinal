package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RejectedIndexesTest {
    private val gson = Gson()

    @Test
    fun acceptedBatchHasNoRejectedSamples() {
        assertEquals(emptySet<Int>(), rejectedIndexes(200, """{"accepted":3,"rejected":[]}""", 3, gson))
    }

    @Test
    fun rejectedSamplesAreGivenByPosition() {
        val body = """{"accepted":1,"rejected":[{"index":0,"reasons":["a"]},{"index":2,"reasons":["b"]}]}"""

        assertEquals(setOf(0, 2), rejectedIndexes(200, body, 3, gson))
    }

    @Test
    fun refusedBatchThrows() {
        for (status in listOf(400, 401, 429, 500, 503)) {
            assertThrows(IOException::class.java) {
                rejectedIndexes(status, """{"error":"refused"}""", 3, gson)
            }
        }
    }

    @Test
    fun answerThatDoesNotAccountForTheBatchThrows() {
        val bodies = listOf(
            "",
            "not json",
            """{"error":"x"}""",
            """{"accepted":2,"rejected":[]}""",
            """{"accepted":2,"rejected":[{"index":3}]}""",
            """{"accepted":1,"rejected":[{"index":0},{"index":0}]}""",
            """{"accepted":2,"rejected":[{"reasons":["a"]}]}""",
        )
        for (body in bodies) {
            assertThrows(body, IOException::class.java) { rejectedIndexes(200, body, 3, gson) }
        }
    }
}
