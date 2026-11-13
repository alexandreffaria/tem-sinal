package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Test

class LoggedDbmTest {
    @Test
    fun usesFirstCellDbmWhenReported() {
        assertEquals(-87, loggedDbm(firstCellDbm = -87, gsmAsu = 12))
    }

    @Test
    fun convertsGsmAsuWhenNoCellDbm() {
        assertEquals(-89, loggedDbm(firstCellDbm = null, gsmAsu = 12))
        assertEquals(-113, loggedDbm(firstCellDbm = null, gsmAsu = 0))
    }

    @Test
    fun unknownWhenNoCellDbmAndGsmAsuUnknown() {
        assertEquals(UNKNOWN_DBM, loggedDbm(firstCellDbm = null, gsmAsu = 99))
    }
}
