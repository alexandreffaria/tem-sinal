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
 * phone usually reports 5 to 15 m; indoors its fixes come from Wi-Fi and cell towers and usually
 * report tens of metres or more, though Wi-Fi alone can report 15 m.
 */
const val GOOD_ACCURACY_M = 30f

/**
 * The fewest satellites used in the fix that count as a good fix. Four is the least a GNSS
 * position needs; indoors a phone can report a Wi-Fi fix as accurate as GPS while using none.
 */
const val GOOD_SATELLITES_USED = 4

/**
 * One tick of a session's start: its fix accuracy in metres, null when the tick had no fresh fix
 * or the fix reported no accuracy, and the number of satellites the GNSS engine last reported as
 * used in its fix.
 */
data class StartTick(val accuracyM: Float?, val satellitesUsed: Int)

/**
 * True when the first [START_TICKS] of [startTicks] look like an indoor or poor-GPS start: most of
 * them had no good fix, that is no fix, an accuracy worse than [GOOD_ACCURACY_M] or fewer than
 * [GOOD_SATELLITES_USED] satellites used. False until there are [START_TICKS] entries; later
 * entries are ignored.
 */
fun startLooksIndoor(startTicks: List<StartTick>): Boolean =
    startTicks.size >= START_TICKS &&
        startTicks.take(START_TICKS).count {
            it.accuracyM == null || it.accuracyM > GOOD_ACCURACY_M || it.satellitesUsed < GOOD_SATELLITES_USED
        } * 2 > START_TICKS
