package dev.meuquerido.cellsignalmapper

import android.telephony.CellInfo

/** A made-up sample with [id]: an invented place and one LTE cell. */
fun testSample(id: String) = Sample(
    schemaVersion = SAMPLE_SCHEMA_VERSION,
    id = id,
    installId = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
    sessionId = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
    timeMs = 1_000L,
    elapsedRealtimeMs = 2_000L,
    fix = Fix(
        lat = -15.5,
        lon = -47.5,
        accuracyM = 5f,
        altitudeM = null,
        verticalAccuracyM = null,
        timeMs = 1_000L,
        elapsedRealtimeMs = 2_000L,
        mock = false,
    ),
    sims = listOf(
        simReading(
            slotIndex = 0,
            simOperator = "00101",
            operatorNumeric = "00101",
            operatorAlphaLong = "Test Network",
            serviceState = ServiceStatus.IN_SERVICE,
            overrideNetworkType = null,
            cells = listOf(
                cellReading(
                    Rat.LTE, registered = true,
                    connectionStatus = CellInfo.CONNECTION_PRIMARY_SERVING, timestampMs = 2_000L,
                    arfcn = 1650, pci = 101, mcc = "001", mnc = "01", ci = 1234L, tac = 42,
                    rsrp = -90,
                ),
            ),
        ),
    ),
)
