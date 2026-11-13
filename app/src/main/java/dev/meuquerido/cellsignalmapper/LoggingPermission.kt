package dev.meuquerido.cellsignalmapper

/**
 * The message shown instead of starting logging, or null when logging may start. Logging needs
 * precise (fine) location, which reading the serving cell requires; approximate location alone
 * is not enough. It also needs phone state access, without which there is no active subscription
 * and so no sample. When both are missing, the location message is shown.
 */
fun loggingDeniedMessage(
    fineLocationGranted: Boolean,
    coarseLocationGranted: Boolean,
    phoneStateGranted: Boolean,
): String? =
    when {
        !fineLocationGranted && coarseLocationGranted ->
            "Logging needs precise location. Allow precise location for this app in Settings."
        !fineLocationGranted -> "Logging needs location access. Allow location for this app in Settings."
        !phoneStateGranted ->
            "Logging needs phone access to read your SIM. Allow Phone for this app in Settings."
        else -> null
    }
