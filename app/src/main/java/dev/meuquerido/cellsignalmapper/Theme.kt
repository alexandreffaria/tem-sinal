package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * One light scheme, the same in system dark mode. Dialogs take their container from
 * `surfaceContainerHigh`, so they are white cards like the screen's.
 */
private val ColorScheme = lightColorScheme(
    primary = Teal,
    onPrimary = Color.White,
    secondary = InkSoft,
    background = Mist,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    onSurfaceVariant = InkSoft,
    surfaceContainerHigh = Color.White,
    error = Sos,
)

/** Dialogs use `extraLarge`: the 20 dp corners of the screen's large cards. */
private val CardShapes = Shapes(extraLarge = RoundedCornerShape(20.dp))

@Composable
fun CellSignalMapperTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ColorScheme,
        shapes = CardShapes,
        typography = Typography,
        content = content
    )
}
