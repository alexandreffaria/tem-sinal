package dev.meuquerido.cellsignalmapper

/** A fix older than this is treated as missing. */
const val MAX_FIX_AGE_MILLIS = 15_000L

/**
 * True when a fix taken at [fixElapsedMillis] is at most [MAX_FIX_AGE_MILLIS] old at
 * [nowElapsedMillis]. Both times are on the elapsed-realtime clock, which never jumps.
 */
fun isFixFresh(fixElapsedMillis: Long, nowElapsedMillis: Long): Boolean =
    nowElapsedMillis - fixElapsedMillis <= MAX_FIX_AGE_MILLIS
