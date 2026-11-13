package dev.meuquerido.cellsignalmapper

/** A fix older than this is treated as missing. */
const val MAX_FIX_AGE_MILLIS = 15_000L

/**
 * True when a fix taken at [fixElapsedMillis] is at most [MAX_FIX_AGE_MILLIS] old at
 * [nowElapsedMillis]. Both times are on the elapsed-realtime clock, which never jumps.
 */
fun isFixFresh(fixElapsedMillis: Long, nowElapsedMillis: Long): Boolean =
    nowElapsedMillis - fixElapsedMillis <= MAX_FIX_AGE_MILLIS

/** The first minute of logging, in ticks, over which [startLooksIndoor] judges a session's start. */
const val START_TICKS = (60_000L / TICK_INTERVAL_MS).toInt()

/**
 * The worst horizontal accuracy, in metres, that counts as a good fix. Outdoors with a clear sky a
 * phone usually reports 5 to 15 m; indoors its fixes come from Wi-Fi and cell towers and report
 * tens of metres or more, so a start where most fixes are worse than this is likely indoors.
 */
const val GOOD_ACCURACY_M = 30f

/**
 * True when the first [START_TICKS] ticks of a session look like an indoor or poor-GPS start: most
 * of them had no good fix. Each entry of [startAccuracies] is one tick's fix accuracy in metres,
 * null when the tick had no fresh fix or the fix reported no accuracy. False until there are
 * [START_TICKS] entries; later entries are ignored.
 */
fun startLooksIndoor(startAccuracies: List<Float?>): Boolean =
    startAccuracies.size >= START_TICKS &&
        startAccuracies.take(START_TICKS).count { it == null || it > GOOD_ACCURACY_M } * 2 > START_TICKS
