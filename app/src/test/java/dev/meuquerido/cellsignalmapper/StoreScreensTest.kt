package dev.meuquerido.cellsignalmapper

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.telephony.CellInfo
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.io.File
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

/**
 * Renders the app screens the Play Store screenshots show, in Portuguese, from made-up state: a
 * place in the forest with no one living there, and invented recordings. With the system property
 * `storeScreens` set to a folder (`-PstoreScreens=<folder>`, as `scripts/store-assets.sh` passes),
 * writes each screen there as `<name>.png`, and the dialog over it as `<name>-dialog.png`; and the
 * launcher icon as `icon.png`, for the store's icon.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "pt-rBR-w400dp-h866dp-xxhdpi")
class StoreScreensTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val out = System.getProperty("storeScreens")?.let(::File)

    private val zone = TimeZone.getDefault()

    @Before
    fun fixZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("America/Sao_Paulo"))
    }

    @After
    fun restoreZone() {
        TimeZone.setDefault(zone)
    }

    private fun sim(slot: Int, plmn: String, serviceState: ServiceStatus, rsrp: Int?) = simReading(
        slotIndex = slot, simOperator = plmn, operatorNumeric = plmn, operatorAlphaLong = null,
        serviceState = serviceState,
        overrideNetworkType = null,
        cells = listOfNotNull(
            rsrp?.let {
                cellReading(
                    Rat.LTE, registered = true,
                    connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING, timestampMs = 2_000L,
                    arfcn = 1650, pci = 101, mcc = plmn.take(3), mnc = plmn.drop(3), ci = 1234L, tac = 42,
                    rsrp = it,
                )
            },
        ),
    )

    /** The screen as the app opens, before any recording: nothing pending, no readings yet. */
    private val idle = LoggerUiState()

    /** Renders [screen], with [dialog] over it when given, and writes the windows as [name]. */
    private fun shoot(name: String, screen: @Composable () -> Unit, dialog: (@Composable () -> Unit)? = null) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CellSignalMapperTheme(darkTheme = false) {
                screen()
                dialog?.invoke()
            }
        }
        // The clock stays at the first frame, where the ping visualizer's circle is full size.
        compose.mainClock.advanceTimeByFrame()
        val windows = listOfNotNull(compose.activity.window.decorView, ShadowDialog.getLatestDialog()?.window?.decorView)
        assertEquals(if (dialog == null) 1 else 2, windows.size)
        windows.forEachIndexed { i, window ->
            val image = compose.runOnUiThread { draw(window) }
            if (i == 0) assertEquals(1200, image.width)
            save(image, if (i == 0) name else "$name-dialog")
        }
    }

    private fun save(image: Bitmap, name: String) {
        val file = out?.resolve("$name.png") ?: return
        file.parentFile?.mkdirs()
        file.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun draw(view: View): Bitmap =
        Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }

    private val noAction = {}

    @Composable
    private fun Main(state: LoggerUiState) =
        MainScreen(state, null, noAction, noAction, noAction, noAction)

    @Test
    fun logging() {
        val sims = listOf(
            sim(0, "72406", ServiceStatus.IN_SERVICE, rsrp = -97),
            sim(1, "72405", ServiceStatus.EMERGENCY_ONLY, rsrp = null),
        )
        val state = LoggerUiState().serviceStarted("store")
            .withSample(-22.90037, -44.10021, sims, PingResult.SUCCESS)
            .copy(pendingCount = 128)
        shoot("logging", { Main(state) })
    }

    @Test
    fun firstLogWarning() {
        shoot("first-log", { Main(idle) }) { FirstLogWarningDialog(noAction, noAction) }
    }

    @Test
    fun recordings() {
        val day = 86_400_000L
        val start = 1_793_620_800_000L // 2026-11-02 09:00 in São Paulo
        val recordings = listOf(
            Recording("c", start + 14 * day + 3_600_000L, sent = 0, listed = 1_436),
            Recording("b", start + 7 * day, sent = 0, listed = 2_210),
            Recording("a", start, sent = 0, listed = 874),
        )
        shoot("recordings", { Main(idle) }) {
            RecordingsDialog(recordings, true, null, null, { true }, {}, noAction)
        }
    }

    /**
     * The launcher icon at 512 px, square, as Play asks (it rounds the corners itself): the middle
     * 72 dp of the 108 dp layers, the part every launcher mask covers.
     */
    @Test
    fun icon() {
        val icon = compose.activity.getDrawable(R.mipmap.ic_launcher) as AdaptiveIconDrawable
        val image = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val layers = 512 * 108 / 72
        val inset = (layers - 512) / 2
        for (layer in listOf(icon.background, icon.foreground)) {
            layer.setBounds(-inset, -inset, layers - inset, layers - inset)
            layer.draw(Canvas(image))
        }
        // The tallest bar is white where the store icon had it, over an opaque sky.
        assertEquals(Color.WHITE, image.getPixel(352, 224))
        assertEquals(255, Color.alpha(image.getPixel(0, 0)))
        save(image, "icon")
    }
}
