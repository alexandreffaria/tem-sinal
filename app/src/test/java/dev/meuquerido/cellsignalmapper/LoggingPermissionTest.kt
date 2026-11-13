package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoggingPermissionTest {
    @Test
    fun allGrantedAllowsLogging() {
        assertNull(
            loggingDeniedMessage(fineLocationGranted = true, coarseLocationGranted = true, phoneStateGranted = true),
        )
    }

    @Test
    fun approximateLocationAloneBlocksLoggingAndAsksForPrecise() {
        val message =
            loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = true, phoneStateGranted = true)

        assertEquals(UiText(R.string.needs_precise_location), message)
    }

    @Test
    fun noLocationBlocksLogging() {
        assertEquals(
            UiText(R.string.needs_location),
            loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = false, phoneStateGranted = true),
        )
    }

    @Test
    fun noPhoneStateBlocksLoggingAndAsksForPhone() {
        val message =
            loggingDeniedMessage(fineLocationGranted = true, coarseLocationGranted = true, phoneStateGranted = false)

        assertEquals(UiText(R.string.needs_phone), message)
    }

    @Test
    fun locationMessageWinsWhenPhoneStateIsAlsoMissing() {
        val message =
            loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = false, phoneStateGranted = false)

        assertEquals(UiText(R.string.needs_location), message)
    }
}
