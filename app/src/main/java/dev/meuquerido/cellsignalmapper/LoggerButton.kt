package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The round LOG/STOP button that calls [onToggle], and under it the number of samples not sent
 * yet, [pendingPoints].
 */
@Composable
fun LoggerButton(isLogging: Boolean, onToggle: () -> Unit, pendingPoints: Int) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(188.dp)
                .shadow(18.dp, CircleShape, ambientColor = Teal, spotColor = Teal)
                .clip(CircleShape)
                .background(Color.White)
                .border(6.dp, Teal, CircleShape)
                .clickable(role = Role.Button, onClick = onToggle),
            contentAlignment = Alignment.Center
        ) {
            Text(
                stringResource(if (isLogging) R.string.stop else R.string.log),
                color = Teal,
                fontFamily = SpaceGrotesk,
                fontWeight = FontWeight.SemiBold,
                fontSize = 26.sp
            )
        }
        Text(
            if (pendingPoints == 0) {
                stringResource(R.string.no_pending_points)
            } else {
                pluralStringResource(R.plurals.pending_points, pendingPoints, pendingPoints)
            },
            color = InkSoft,
            fontSize = 14.sp,
            textAlign = TextAlign.Center
        )
    }
}

/** [text] in a card, with a Dismiss button that calls [onDismiss] when it is given. */
@Composable
fun Note(text: UiText, onDismiss: (() -> Unit)? = null) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(CardWhite)
            .padding(start = 16.dp, top = 14.dp, end = 8.dp, bottom = if (onDismiss == null) 14.dp else 0.dp)
    ) {
        Text(text.resolve(), color = Ink, fontSize = 14.sp, modifier = Modifier.padding(end = 8.dp))
        if (onDismiss != null) {
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) {
                Text(stringResource(R.string.dismiss))
            }
        }
    }
}
