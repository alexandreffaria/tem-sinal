package dev.meuquerido.cellsignalmapper

import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlin.random.Random
import kotlinx.coroutines.delay

/** The width and height the hills are drawn in, a 390 x 844 phone, scaled to the canvas. */
private const val SCENE_WIDTH = 390f
private const val SCENE_HEIGHT = 844f

/** Each hill band's top edge: a start point, then cubic segments of three points each. */
private val hills = listOf(
    HillFar to floatArrayOf(0f, 360f, 70f, 330f, 120f, 345f, 180f, 320f, 250f, 292f, 320f, 330f, 390f, 310f),
    HillMiddle to floatArrayOf(0f, 430f, 90f, 400f, 150f, 420f, 220f, 395f, 290f, 372f, 340f, 400f, 390f, 388f),
    HillNear to floatArrayOf(0f, 520f, 80f, 495f, 160f, 515f, 230f, 490f, 300f, 468f, 350f, 492f, 390f, 482f),
)

/** Each pine's left foot, width and height. */
private val pines = listOf(
    floatArrayOf(24f, 520f, 16f, 26f),
    floatArrayOf(44f, 516f, 12f, 20f),
    floatArrayOf(330f, 488f, 14f, 24f),
)

/** The hill bands and pines over [Mist], filling the canvas behind the content. */
@Composable
fun Hills(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        drawRect(Mist)
        val sx = size.width / SCENE_WIDTH
        val sy = size.height / SCENE_HEIGHT
        for ((color, edge) in hills) {
            val path = Path().apply {
                moveTo(edge[0] * sx, edge[1] * sy)
                for (i in 2 until edge.size step 6) {
                    cubicTo(
                        edge[i] * sx, edge[i + 1] * sy, edge[i + 2] * sx, edge[i + 3] * sy,
                        edge[i + 4] * sx, edge[i + 5] * sy,
                    )
                }
                lineTo(size.width, size.height)
                lineTo(0f, size.height)
                close()
            }
            drawPath(path, color)
        }
        for ((x, y, w, h) in pines) {
            val path = Path().apply {
                moveTo(x * sx, y * sy)
                lineTo((x + w / 2) * sx, (y - h) * sy)
                lineTo((x + w) * sx, y * sy)
                close()
            }
            drawPath(path, Pine)
        }
    }
}

/** How long a flock takes to cross the screen, in milliseconds. */
const val FLIGHT_MS = 6_000L

/**
 * One flock: [birds] birds (1 to 3), flying in after [waitMs] (20 to 30 s) at [top], a fraction
 * (0.2 to 0.8) of the height of the area they cross.
 */
data class Flock(val birds: Int, val top: Float, val waitMs: Long)

/** The next flock, at random from [random]. */
fun nextFlock(random: Random): Flock = Flock(
    birds = random.nextInt(1, 4),
    top = 0.2f + 0.6f * random.nextFloat(),
    waitMs = random.nextLong(20_000L, 30_001L),
)

/** Birds fly only when animations are on: a duration scale of 0 is the system's reduce motion. */
fun birdsAllowed(animatorDurationScale: Float): Boolean = animatorDurationScale > 0f

private fun animatorDurationScale(context: Context): Float =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)

/**
 * Each bird's wings in the flock, in dp from the flock's top left: the left wing tip x, the wing
 * tips' y, the span and how high the wings rise. A flock of n birds draws the first n.
 */
private val flockShape = listOf(
    floatArrayOf(2f, 8f, 16f, 5f),
    floatArrayOf(24f, 15f, 12f, 4f),
    floatArrayOf(40f, 6f, 12f, 4f),
)
private const val FLOCK_WIDTH_DP = 54f

/** When each bird's wingbeat starts, so the flock doesn't flap in step. */
private val flapDelayMs = longArrayOf(0L, 200L, 350L)

/**
 * Now and then a flock flies across this area, left to right and climbing a little, with
 * [nextFlock]'s timing; nothing between flocks. None while the app is in the background or
 * [birdsAllowed] says no.
 */
@Composable
fun Birds(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var flock by remember { mutableStateOf<Flock?>(null) }
    var flownMs by remember { mutableStateOf(0L) }
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                val next = nextFlock(Random.Default)
                delay(next.waitMs)
                if (!birdsAllowed(animatorDurationScale(context))) continue
                val start = withFrameMillis { it }
                try {
                    flock = next
                    flownMs = 0L
                    while (flownMs < FLIGHT_MS) flownMs = withFrameMillis { it } - start
                } finally {
                    flock = null
                }
            }
        }
    }
    Canvas(modifier) {
        val flying = flock ?: return@Canvas
        val progress = flownMs.toFloat() / FLIGHT_MS
        val flockWidth = FLOCK_WIDTH_DP * density
        val origin = Offset(
            x = -flockWidth + progress * (size.width + 2 * flockWidth),
            y = flying.top * size.height - progress * 50f * density,
        )
        for (i in 0 until flying.birds) drawBird(origin, flockShape[i], wingScale(flownMs + flapDelayMs[i]))
    }
}

/** How far the wings are open, 1 (up) to 0.35 (down), half a second each way, eased. */
private fun wingScale(ms: Long): Float {
    val phase = (ms % 1_000L) / 500f
    val t = if (phase <= 1f) phase else 2f - phase
    val eased = t * t * (3f - 2f * t)
    return 1f - 0.65f * eased
}

/** One "v" of two curves, its height scaled by [scale] about its middle. */
private fun DrawScope.drawBird(origin: Offset, shape: FloatArray, scale: Float) {
    val (x, y, span, lift) = shape
    val middle = y - lift / 2
    fun px(dpX: Float) = origin.x + dpX * density
    fun py(dpY: Float) = origin.y + (middle + (dpY - middle) * scale) * density
    val q = span / 4
    val path = Path().apply {
        moveTo(px(x), py(y))
        quadraticTo(px(x + q), py(y - lift), px(x + 2 * q), py(y))
        quadraticTo(px(x + 3 * q), py(y - lift), px(x + 4 * q), py(y))
    }
    drawPath(path, BirdInk, style = Stroke(width = 1.4f * density, cap = StrokeCap.Round))
}
