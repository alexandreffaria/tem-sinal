package dev.meuquerido.cellsignalmapper

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch

class AfterCompletionTest {
    @Test
    fun cancelledJobRunsTheActionAfterItsLastWrite() = runBlocking {
        val events = Collections.synchronizedList(mutableListOf<String>())
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val job = CoroutineScope(Dispatchers.Default).launch {
            started.countDown()
            // Blocks without suspending, like a tick past its last suspension point.
            release.await()
            events += "write"
        }
        started.await()
        job.cancel()
        afterCompletion(job) { events += "enqueue" }
        assertEquals(emptyList<String>(), events.toList())

        release.countDown()
        job.join()
        assertEquals(listOf("write", "enqueue"), events.toList())
    }

    @Test
    fun completedJobRunsTheActionStraightAway() {
        val job = Job().apply { complete() }
        var ran = false
        afterCompletion(job) { ran = true }
        assertTrue(ran)
    }

    @Test
    fun noJobRunsTheActionStraightAway() {
        var ran = false
        afterCompletion(null) { ran = true }
        assertTrue(ran)
    }
}
