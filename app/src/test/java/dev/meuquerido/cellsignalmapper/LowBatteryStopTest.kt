package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LowBatteryStopTest {
    @Test
    fun stopsAtTheThreshold() {
        assertTrue(stopsForLowBattery(level = LOW_BATTERY_STOP_PERCENT, scale = 100, plugged = false))
    }

    @Test
    fun stopsBelowTheThreshold() {
        assertTrue(stopsForLowBattery(level = 3, scale = 100, plugged = false))
    }

    @Test
    fun keepsLoggingAboveTheThreshold() {
        assertFalse(stopsForLowBattery(level = LOW_BATTERY_STOP_PERCENT + 1, scale = 100, plugged = false))
    }

    @Test
    fun readsTheLevelAgainstItsScale() {
        assertTrue(stopsForLowBattery(level = 25, scale = 255, plugged = false))
        assertFalse(stopsForLowBattery(level = 26, scale = 255, plugged = false))
    }

    @Test
    fun keepsLoggingWhileCharging() {
        assertFalse(stopsForLowBattery(level = 3, scale = 100, plugged = true))
    }

    @Test
    fun keepsLoggingWhenTheLevelIsUnknown() {
        assertFalse(stopsForLowBattery(level = -1, scale = 100, plugged = false))
        assertFalse(stopsForLowBattery(level = 5, scale = -1, plugged = false))
        assertFalse(stopsForLowBattery(level = 5, scale = 0, plugged = false))
    }
}
