package dev.meuquerido.cellsignalmapper

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.util.Locale

class CoordinatesTest {
    private lateinit var savedLocale: Locale

    @Before
    fun setDecimalCommaLocale() {
        savedLocale = Locale.getDefault()
        Locale.setDefault(Locale("pt", "BR"))
    }

    @After
    fun restoreLocale() {
        Locale.setDefault(savedLocale)
    }

    @Test
    fun roundsToFiveDecimalPlacesUnderDecimalCommaLocale() {
        assertEquals(-12.34568, roundCoordinate(-12.345678), 0.0)
        assertEquals(45.67891, roundCoordinate(45.678912), 0.0)
    }

    @Test
    fun roundsHalfUp() {
        assertEquals(1.00001, roundCoordinate(1.000005), 0.0)
        assertEquals(-1.00001, roundCoordinate(-1.000005), 0.0)
    }

    @Test
    fun keepsValuesWithFewerDecimalPlaces() {
        assertEquals(10.5, roundCoordinate(10.5), 0.0)
        assertEquals(0.0, roundCoordinate(0.0), 0.0)
    }
}
