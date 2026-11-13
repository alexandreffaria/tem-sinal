package dev.meuquerido.cellsignalmapper

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun LoggerButton(
    isLogging: Boolean,
    onToggle: () -> Unit,
    onUpload: () -> Unit,
    modifier: Modifier = Modifier,
    location: String = "",
    signalStrength: String = "",
    pendingPoints: Int = 0,
    debugText: String
) {
    val tapCount = remember { mutableIntStateOf(0) }
    val showDebug = remember { mutableStateOf(false) }


    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {


        Text("$pendingPoints pending points stored")
        Spacer(modifier = Modifier.height(50.dp))
        Button(
            onClick = onToggle,
            modifier = Modifier.size(200.dp)
        ) {
            Text(if (isLogging) "STOP" else "LOG")
        }
        if (pendingPoints > 0) {
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = onUpload) {
                Text("Send my data")
            }
        }
        Spacer(modifier = Modifier.height(32.dp))
        Text(location)
        Text(signalStrength)


        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(100.dp)
                .clickable {
                    tapCount.intValue++
                    if (tapCount.intValue >= 10) {
                        showDebug.value = !showDebug.value
                        tapCount.intValue = 0
                    }
                }
        )

        if (showDebug.value) {
            Text(debugText)
        }
    }
}
