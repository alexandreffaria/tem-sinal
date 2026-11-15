package dev.meuquerido.cellsignalmapper

import android.telephony.ServiceState.STATE_OUT_OF_SERVICE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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

    private fun wait(tickOnFix: Boolean, fixDelivered: Boolean, nowMs: Long) =
        msUntilNextTick(tickStartMs = 10_000L, tickOnFix = tickOnFix, fixDelivered = fixDelivered, nowMs = nowMs)

    @Test
    fun withoutAFixTheNextTickStartsAFixedIntervalAfterThisOneStarted() {
        for (tickOnFix in listOf(false, true)) {
            assertEquals(TICK_INTERVAL_MS, wait(tickOnFix, fixDelivered = false, nowMs = 10_000L))
            assertEquals(1_500L, wait(tickOnFix, fixDelivered = false, nowMs = 13_500L))
            assertEquals(0L, wait(tickOnFix, fixDelivered = false, nowMs = 15_000L))
            assertEquals(0L, wait(tickOnFix, fixDelivered = false, nowMs = 18_000L))
        }
    }

    @Test
    fun aFixAfterATickOnAFixStartsTheNextAtOnce() {
        assertEquals(0L, wait(tickOnFix = true, fixDelivered = true, nowMs = 14_990L))
        assertEquals(0L, wait(tickOnFix = true, fixDelivered = true, nowMs = 15_200L))
    }

    @Test
    fun aFixSoonAfterATickWithoutOneWaitsForTheInterval() {
        assertEquals(4_000L, wait(tickOnFix = false, fixDelivered = true, nowMs = 11_000L))
        assertEquals(0L, wait(tickOnFix = false, fixDelivered = true, nowMs = 15_000L))
    }

    @Test
    fun aTickLateFromASleepingCpuStartsAtOnce() {
        // The elapsed-realtime clock counted the sleep, so the interval has passed.
        assertEquals(0L, wait(tickOnFix = false, fixDelivered = false, nowMs = 40_000L))
    }
}
