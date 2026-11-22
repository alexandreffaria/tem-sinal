package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MockPlaceTest {
    @Test
    fun placeOnTheGlobeWithAccuracyIsKept() {
        assertEquals(MockPlace(-10.5, -50.25, 12f), mockPlace(-10.5, -50.25, 12f))
    }

    @Test
    fun missingAccuracyIsFiveMetres() {
        assertEquals(MockPlace(-10.5, -50.25, 5f), mockPlace(-10.5, -50.25, null))
    }

    @Test
    fun edgesOfTheGlobeAreKept() {
        assertEquals(MockPlace(90.0, 180.0, 5f), mockPlace(90.0, 180.0, null))
        assertEquals(MockPlace(-90.0, -180.0, 5f), mockPlace(-90.0, -180.0, null))
    }

    @Test
    fun missingLatOrLonIsRefused() {
        assertNull(mockPlace(null, -50.25, null))
        assertNull(mockPlace(-10.5, null, null))
    }

    @Test
    fun placeOffTheGlobeIsRefused() {
        assertNull(mockPlace(90.1, 0.0, null))
        assertNull(mockPlace(0.0, -180.1, null))
        assertNull(mockPlace(Double.NaN, 0.0, null))
    }

    @Test
    fun accuracyThatIsNotPositiveIsRefused() {
        assertNull(mockPlace(0.0, 0.0, 0f))
        assertNull(mockPlace(0.0, 0.0, -1f))
        assertNull(mockPlace(0.0, 0.0, Float.NaN))
        assertNull(mockPlace(0.0, 0.0, Float.POSITIVE_INFINITY))
    }
}
