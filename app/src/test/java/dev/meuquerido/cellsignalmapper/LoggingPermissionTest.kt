package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggingPermissionTest {
    @Test
    fun fineLocationAllowsLogging() {
        assertNull(loggingDeniedMessage(fineLocationGranted = true, coarseLocationGranted = true))
    }

    @Test
    fun approximateLocationAloneBlocksLoggingAndAsksForPrecise() {
        val message = loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = true)

        assertNotNull(message)
        assertTrue(message!!.contains("precise location"))
    }

    @Test
    fun noLocationBlocksLogging() {
        assertNotNull(loggingDeniedMessage(fineLocationGranted = false, coarseLocationGranted = false))
    }
}
