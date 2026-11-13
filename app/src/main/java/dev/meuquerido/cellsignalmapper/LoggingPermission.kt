package dev.meuquerido.cellsignalmapper

/**
 * The message shown instead of starting logging, or null when logging may start. Logging needs
 * precise (fine) location, which reading the serving cell requires; approximate location alone
 * is not enough.
 */
fun loggingDeniedMessage(fineLocationGranted: Boolean, coarseLocationGranted: Boolean): String? =
    when {
        fineLocationGranted -> null
        coarseLocationGranted ->
            "Logging needs precise location. Allow precise location for this app in Settings."
        else -> "Logging needs location access. Allow location for this app in Settings."
    }
