package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadPreviewTest {
    private val gson = Gson()

    // A made-up sample whose carrier name needs escaping and whose numbers have fractions.
    private val sample = testSample("a").let { s ->
        s.copy(
            fix = s.fix.copy(altitudeM = 1100.25),
            sims = s.sims.map { it.copy(operatorName = "Operadora <Teste> & \"Ç\"") },
        )
    }

    /** [json] without the whitespace between its tokens; whitespace inside strings stays. */
    private fun compact(json: String): String {
        val out = StringBuilder()
        var inString = false
        var escaped = false
        for (c in json) {
            if (inString) {
                out.append(c)
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
            } else if (!c.isWhitespace()) {
                out.append(c)
                if (c == '"') inString = true
            }
        }
        return out.toString()
    }

    @Test
    fun previewIsTheUploadBodyWithOnlyWhitespaceAdded() {
        val preview = uploadPreview(listOf(sample), gson)

        assertEquals(uploadBody(listOf(sample), gson), compact(preview))
        assertTrue(preview.lines().size > 1)
    }

    @Test
    fun bodyCarriesTheSamplesAsLoggedWithTheirIds() {
        val body = uploadBody(listOf(sample, testSample("b")), gson)

        assertEquals(
            """{"samples":[${gson.toJson(sample)},${gson.toJson(testSample("b"))}]}""",
            body,
        )
        assertTrue(body.contains("\"installId\":\"${sample.installId}\""))
        assertTrue(body.contains("\"sessionId\":\"${sample.sessionId}\""))
    }
}
