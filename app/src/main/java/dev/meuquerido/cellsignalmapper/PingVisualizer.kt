package dev.meuquerido.cellsignalmapper

import android.util.Log
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.animation.core.LinearEasing

@Composable
fun PingVisualizer(
    result: String,
    modifier: Modifier = Modifier,
    animationKey: Int
) {
    val color = when (result) {
        "SUCCESS" -> Color(0xFF4CAF50)
        "DUPLICATE" -> Color(0xFFFFC107)
        "BAD" -> Color(0xFFF44336)
        else -> Color.LightGray
    }

    var scale by remember { mutableStateOf(1f) }

    LaunchedEffect(result, animationKey) {
        Log.d("PingVisualizer", "New ping: result=$result, animationKey=$animationKey")
        scale = 1f
        animate(
            initialValue = 1f,
            targetValue = 0f,
            animationSpec = tween(durationMillis = 5000, easing = LinearEasing)
        ) { value, _ ->
            scale = value
        }
    }

    Box(
        modifier = modifier
            .size(100.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .background(color, shape = CircleShape)
    )
}
