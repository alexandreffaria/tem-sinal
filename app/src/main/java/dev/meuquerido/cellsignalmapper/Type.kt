package dev.meuquerido.cellsignalmapper

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

/** The wordmark, the button label and the big card values: Space Grotesk SemiBold only. */
val SpaceGrotesk = FontFamily(Font(R.font.space_grotesk_semibold, FontWeight.SemiBold))

/** Everything else, in the two weights Material's styles use. */
val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
)

private fun TextStyle.inter() = copy(fontFamily = Inter)

/** Material's type scale, in [Inter]. */
val Typography = with(Typography()) {
    Typography(
        displayLarge = displayLarge.inter(),
        displayMedium = displayMedium.inter(),
        displaySmall = displaySmall.inter(),
        headlineLarge = headlineLarge.inter(),
        headlineMedium = headlineMedium.inter(),
        headlineSmall = headlineSmall.inter(),
        titleLarge = titleLarge.inter(),
        titleMedium = titleMedium.inter(),
        titleSmall = titleSmall.inter(),
        bodyLarge = bodyLarge.inter(),
        bodyMedium = bodyMedium.inter(),
        bodySmall = bodySmall.inter(),
        labelLarge = labelLarge.inter(),
        labelMedium = labelMedium.inter(),
        labelSmall = labelSmall.inter(),
    )
}
