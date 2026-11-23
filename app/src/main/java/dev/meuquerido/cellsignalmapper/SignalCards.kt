package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The four bars' heights, shortest first. */
private val barHeights = listOf(5.dp, 9.dp, 12.dp, 16.dp)

/**
 * One card per SIM in [sims], two to a row, or a card saying there is none when it is empty;
 * nothing when it is null. Under them, [gps] and [signalStrength] on one small line.
 */
@Composable
fun SignalCards(sims: List<SimCard>?, gps: UiText?, signalStrength: UiText?) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            sims == null -> {}
            sims.isEmpty() -> Note(UiText(R.string.no_active_sim))
            else -> sims.chunked(2).forEach { row ->
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { SimCardView(it, Modifier.weight(1f).fillMaxHeight()) }
                }
            }
        }
        val line = listOfNotNull(gps, signalStrength).map { it.resolve() }.joinToString(" · ")
        if (line.isNotEmpty()) {
            Text(
                line,
                modifier = Modifier.fillMaxWidth(),
                color = InkSoft,
                fontSize = 12.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun SimCardView(card: SimCard, modifier: Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(CardWhite)
            .padding(14.dp)
    ) {
        Text(card.label.resolve().uppercase(), color = InkMuted, fontSize = 11.sp, letterSpacing = 1.sp)
        Text(
            card.value,
            modifier = Modifier.padding(top = 6.dp),
            color = if (card.emergency) Sos else Ink,
            fontFamily = SpaceGrotesk,
            fontWeight = FontWeight.SemiBold,
            fontSize = 22.sp
        )
        Spacer(Modifier.height(6.dp))
        card.bars?.let { SignalBars(it) }
        card.detail?.let { Text(it.resolve(), color = InkMuted, fontSize = 12.sp) }
    }
}

/** [bars] of four lit, read out as "3 of 4 bars". */
@Composable
private fun SignalBars(bars: Int) {
    val description = stringResource(R.string.signal_bars, bars)
    Row(
        modifier = Modifier
            .height(16.dp)
            .clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        barHeights.forEachIndexed { i, height ->
            Box(
                Modifier
                    .width(5.dp)
                    .height(height)
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (i < bars) Teal else BarOff)
            )
        }
    }
}
