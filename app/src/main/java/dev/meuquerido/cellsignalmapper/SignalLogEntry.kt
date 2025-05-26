package dev.meuquerido.cellsignalmapper

data class SignalLogEntry(
    val id: String,
    val timestamp: Long,
    val latitude: Double?,
    val longitude: Double?,
    val signalDbm: Int,
    val carrier: String,
    val mcc: String,
    val mnc: String,
    val cellInfo: String
)
