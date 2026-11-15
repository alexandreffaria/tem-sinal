package dev.meuquerido.cellsignalmapper

import android.telephony.ServiceState.STATE_OUT_OF_SERVICE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Made-up ticks at an invented place: which ones build a sample, and when the next one starts. */
class TickSampleTest {
    private val fix = Fix(
        lat = -15.5, lon = -47.5, accuracyM = 5f, altitudeM = null, verticalAccuracyM = null,
        timeMs = 1_000L, elapsedRealtimeMs = 2_000L, mock = false,
    )

    private fun sim(serviceState: ServiceStatus?, cells: List<CellReading>?) = simReading(
        slotIndex = 0, simOperator = "00101", operatorNumeric = null, operatorAlphaLong = null,
        serviceState = serviceState, overrideNetworkType = null, cells = cells,
    )

    private fun sampleOf(vararg sims: SimReading) = sample(
        installId = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
        sessionId = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
        timeMs = 1_000L,
        elapsedRealtimeMs = 2_000L,
        fix = fix,
        sims = sims.toList(),
    )

    @Test
    fun aTickWithAFixAndNoSignalIsLogged() {
        val outOfService = serviceStatus(STATE_OUT_OF_SERVICE, emptyList(), airplaneModeOn = false)
        val noSignal = sampleOf(sim(outOfService, emptyList()))

        assertNotNull(noSignal)
        assertEquals(ServiceStatus.OUT_OF_SERVICE, noSignal!!.sims.single().serviceState)
        assertEquals(emptyList<CellReading>(), noSignal.sims.single().cells)
    }

    @Test
    fun aNoSignalTickAtTheSamePlaceAsTheLastSampleIsLogged() {
        val last = sampleOf(sim(ServiceStatus.OUT_OF_SERVICE, emptyList()))
        val again = sampleOf(sim(ServiceStatus.OUT_OF_SERVICE, emptyList()))

        assertNotNull(again)
        assertEquals(last!!.fix, again!!.fix)
        assertEquals(last.sims, again.sims)
        assertNotEquals(last.id, again.id)
    }

    @Test
    fun aTickWithoutASubscriptionHasNoSample() {
        assertNull(sampleOf())
    }

    @Test
    fun withoutAFixTheNextTickStartsLaterThanTheFixInterval() {
        assertEquals(NO_FIX_TICK_AFTER_MS, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = false, nowMs = 10_000L))
        assertEquals(1_000L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = false, nowMs = 15_500L))
        assertEquals(0L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = false, nowMs = 16_500L))
    }

    @Test
    fun aFixStartsTheNextTickOnceTheMinimumGapHasPassed() {
        assertEquals(3_500L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = true, nowMs = 11_000L))
        assertEquals(0L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = true, nowMs = 14_500L))
        assertEquals(0L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = true, nowMs = 15_100L))
    }

    @Test
    fun aTickLateFromASleepingCpuStartsAtOnce() {
        // The elapsed-realtime clock counted the sleep, so the wait has passed.
        assertEquals(0L, msUntilNextTick(tickStartMs = 10_000L, fixDelivered = false, nowMs = 40_000L))
    }

    private data class Tick(val startMs: Long, val onFix: Boolean)

    /**
     * The ticks the logging loop starts until [untilMs], each taking [workMs], when fixes are
     * delivered at [deliveries]; the first tick starts at 0.
     */
    private fun runTicks(deliveries: List<Long>, untilMs: Long, workMs: Long = 400L): List<Tick> {
        val ticks = mutableListOf(Tick(0L, onFix = false))
        var next = 0
        while (true) {
            val startMs = ticks.last().startMs
            var nowMs = startMs + workMs
            var fixDelivered = false
            while (true) {
                while (next < deliveries.size && deliveries[next] <= nowMs) {
                    next++
                    fixDelivered = true
                }
                val waitMs = msUntilNextTick(startMs, fixDelivered, nowMs)
                if (waitMs == 0L) break
                val delivery = deliveries.getOrNull(next)
                nowMs = if (delivery != null && delivery <= nowMs + waitMs) delivery else nowMs + waitMs
            }
            if (nowMs > untilMs) return ticks
            ticks += Tick(nowMs, fixDelivered)
        }
    }

    /** Fixes from [fromMs], just over [TICK_INTERVAL_MS] apart with some jitter, until [untilMs]. */
    private fun deliveries(fromMs: Long, untilMs: Long): List<Long> {
        val jitterMs = listOf(50L, 120L, 10L, 300L, 80L, 200L)
        return generateSequence(fromMs to 0) { (atMs, i) ->
            atMs + TICK_INTERVAL_MS + jitterMs[i % jitterMs.size] to i + 1
        }.map { it.first }.takeWhile { it <= untilMs }.toList()
    }

    @Test
    fun ticksFollowFixesKeepTheirGapAndGoOnWithoutFixes() {
        val beforeGap = deliveries(fromMs = 1_200L, untilMs = 45_000L)
        val afterGap = deliveries(fromMs = 75_300L, untilMs = 130_000L)
        val ticks = runTicks(beforeGap + afterGap, untilMs = 130_000L)

        ticks.zipWithNext().forEach { (a, b) ->
            assertTrue("ticks at ${a.startMs} and ${b.startMs}", b.startMs - a.startMs >= MIN_TICK_GAP_MS)
        }
        // One tick per fix, so no no-fix tick lands just before one. A fix soon after a tick
        // waits for the minimum gap, until the ticks catch up with the fixes.
        val ticksBeforeGap = ticks.filter { it.startMs in 1..beforeGap.last() }
        assertEquals(beforeGap.size, ticksBeforeGap.size)
        assertTrue(ticksBeforeGap.all { it.onFix })
        assertEquals(
            beforeGap.filter { it >= 30_000L },
            ticksBeforeGap.filter { it.startMs >= 30_000L }.map { it.startMs },
        )
        // Without fixes, ticks go on.
        val ticksInGap = ticks.filter { it.startMs > beforeGap.last() && it.startMs < afterGap.first() }
        assertTrue(ticksInGap.size >= 4)
        assertTrue(ticksInGap.none { it.onFix })
        // Once fixes come back, they start the ticks again, one per fix.
        assertEquals(
            afterGap.filter { it >= 110_000L },
            ticks.filter { it.startMs >= 110_000L }.map { it.startMs },
        )
    }
}
