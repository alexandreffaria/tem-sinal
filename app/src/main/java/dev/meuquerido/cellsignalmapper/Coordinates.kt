package dev.meuquerido.cellsignalmapper

import java.math.RoundingMode

/**
 * Rounds a coordinate to 5 decimal places, half up, the same as `"%.5f"` but without
 * going through text, so the result doesn't depend on the default locale.
 */
fun roundCoordinate(value: Double): Double =
    value.toBigDecimal().setScale(5, RoundingMode.HALF_UP).toDouble()
