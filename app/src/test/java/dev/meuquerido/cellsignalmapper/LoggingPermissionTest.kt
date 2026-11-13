package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

        assertNotNull(message)
        assertTrue(message!!.contains("precise location"))
    }

    @Test
    fun noLocationBlocksLogging() {
        assertNotNull(
            loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = false, phoneStateGranted = true),
        )
    }

    @Test
    fun noPhoneStateBlocksLoggingAndAsksForPhone() {
        val message =
            loggingDeniedMessage(fineLocationGranted = true, coarseLocationGranted = true, phoneStateGranted = false)

        assertNotNull(message)
        assertTrue(message!!.contains("phone access"))
    }

    @Test
    fun locationMessageWinsWhenPhoneStateIsAlsoMissing() {
        val message =
            loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = false, phoneStateGranted = false)

        assertNotNull(message)
        assertTrue(message!!.contains("location access"))
    }
}
