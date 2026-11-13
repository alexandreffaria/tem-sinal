package dev.meuquerido.cellsignalmapper

import java.io.IOException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RetryUploadTest {
    @Test
    fun failedUploadWithSamplesPendingIsRetried() {
        assertTrue(retryUpload(uploaded = false, pendingCount = Result.success(3)))
    }

    @Test
    fun failedUploadWhosePendingCountCantBeReadIsRetried() {
        assertTrue(retryUpload(uploaded = false, pendingCount = Result.failure(IOException())))
    }

    @Test
    fun nothingToUploadIsNotRetried() {
        assertFalse(retryUpload(uploaded = false, pendingCount = Result.success(0)))
    }

    @Test
    fun successfulUploadIsNotRetriedEvenWithSamplesLoggedMeanwhile() {
        assertFalse(retryUpload(uploaded = true, pendingCount = Result.success(5)))
    }
}
