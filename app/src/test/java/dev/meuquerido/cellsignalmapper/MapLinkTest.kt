package dev.meuquerido.cellsignalmapper

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The "See the map" link on the main screen, with a [UriHandler] that records or refuses. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "en-w400dp-h866dp")
class MapLinkTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(handler: UriHandler) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CompositionLocalProvider(LocalUriHandler provides handler) {
                CellSignalMapperTheme {
                    MainScreen(LoggerUiState(), null, {}, {}, {}, {})
                }
            }
        }
        compose.mainClock.advanceTimeByFrame()
    }

    private val seeMap get() = compose.onNodeWithContentDescription(compose.activity.getString(R.string.see_map))

    @Test
    fun opensTheMapUrl() {
        val opened = mutableListOf<String>()
        show(object : UriHandler {
            override fun openUri(uri: String) {
                opened += uri
            }
        })

        seeMap.performClick()

        assertEquals(listOf(MAP_URL), opened)
    }

    @Test
    fun staysOnTheScreenWhenNoAppOpensWebPages() {
        show(object : UriHandler {
            override fun openUri(uri: String) = throw IllegalArgumentException("no browser")
        })

        seeMap.performClick()
        compose.mainClock.advanceTimeByFrame()

        seeMap.assertIsDisplayed()
    }
}
