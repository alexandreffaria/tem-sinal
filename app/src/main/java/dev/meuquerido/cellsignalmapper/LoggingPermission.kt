package dev.meuquerido.cellsignalmapper

/**
 * The message shown instead of starting logging, or null when logging may start. Logging needs
 * precise (fine) location, which reading the serving cell requires;
 * approximate location alone is not enough. It also needs phone state access, without which there
 * is no active subscription and so no sample. When both are missing, the location message is shown.
 */
fun loggingDeniedMessage(
    fineLocationGranted: Boolean,
    coarseLocationGranted: Boolean,
    phoneStateGranted: Boolean,
): UiText? =
    when {
        !fineLocationGranted && coarseLocationGranted ->
            UiText(R.string.needs_precise_location)
        !fineLocationGranted -> UiText(R.string.needs_location)
        !phoneStateGranted -> UiText(R.string.needs_phone)
        else -> null
    }
