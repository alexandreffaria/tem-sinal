package dev.meuquerido.cellsignalmapper

import androidx.compose.ui.graphics.Color

/** The screen's background, the mist above the hills; also the window background in `colors.xml`. */
val Mist = Color(0xFFE6ECEA)

/** The hill bands, far to near, and the pines on them. */
val HillFar = Color(0xFFD6E0DD)
val HillMiddle = Color(0xFFC6D3CF)
val HillNear = Color(0xFFB3C4BF)
val Pine = Color(0xFF9FB3AD)

val Ink = Color(0xFF1F2B2C)
val InkSoft = Color(0xFF3F4F50)
val InkMuted = Color(0xFF5C6B6C)
val BirdInk = Color(0xFF4B5D5E)

/** The accent: the button ring, links and signal bars. */
val Teal = Color(0xFF2E6468)

/** Emergency calls only; never the accent. */
val Sos = Color(0xFFB5541E)

/** Cards: white at 85 % opacity. */
val CardWhite = Color(0xD9FFFFFF)

/** The recording pill: white at 70 % opacity. */
val PillWhite = Color(0xB3FFFFFF)

val Divider = Color(0xFFE1E8E6)

/** A signal bar that is not lit. */
val BarOff = HillMiddle
