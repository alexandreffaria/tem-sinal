package dev.meuquerido.cellsignalmapper

import androidx.annotation.StringRes

/**
 * The string resource of the message shown instead of starting logging, or null when logging may
 * start. Logging needs precise (fine) location, which reading the serving cell requires;
 * approximate location alone is not enough. It also needs phone state access, without which there
 * is no active subscription and so no sample. When both are missing, the location message is shown.
 */
@StringRes
fun loggingDeniedMessage(
    fineLocationGranted: Boolean,
    coarseLocationGranted: Boolean,
    phoneStateGranted: Boolean,
): Int? =
    when {
        !fineLocationGranted && coarseLocationGranted ->
            R.string.needs_precise_location
        !fineLocationGranted -> R.string.needs_location
        !phoneStateGranted -> R.string.needs_phone
        else -> null
    }
