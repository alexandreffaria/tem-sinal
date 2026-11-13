package dev.meuquerido.cellsignalmapper

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test

/** The wire names in `docs/sample-schema.md`; a renamed property fails this test. */
class SampleJsonTest {
    private val gson = Gson()

    // A made-up place and made-up readings.
    private val sample = Sample(
        schemaVersion = SAMPLE_SCHEMA_VERSION,
        id = "6f1c0a52-3b7e-4c1d-9a8e-2d5b7c9e4f10",
        installId = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
        sessionId = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
        timeMs = 1_767_261_600_000L,
        elapsedRealtimeMs = 86_400_000L,
        fix = Fix(
            lat = -15.5,
            lon = -47.5,
            accuracyM = 4.5f,
            altitudeM = 1100.0,
            verticalAccuracyM = null,
            timeMs = 1_767_261_599_000L,
            elapsedRealtimeMs = 86_399_000L,
            mock = false,
        ),
        sims = listOf(
            SimReading(
                slot = 0,
                simPlmn = "72406",
                registeredPlmn = "72406",
                operatorName = "VIVO",
                serviceState = ServiceStatus.IN_SERVICE,
                overrideNetworkType = OverrideNetworkType.NR_NSA,
                cells = listOf(
                    CellReading(
                        source = CellSource.CELL_INFO,
                        rat = Rat.LTE,
                        registered = true,
                        connection = CellConnection.PRIMARY_SERVING,
                        timestampMs = 86_399_500L,
                        arfcn = 1650,
                        pci = 101,
                        plmn = "72406",
                        ci = 12_345_678L,
                        tac = 4321,
                        rsrp = -98,
                        rsrq = -11,
                        sinr = 7,
                        rssi = -67,
                        rscp = null,
                        ecno = null,
                    ),
                    CellReading(
                        source = CellSource.SIGNAL_STRENGTH,
                        rat = Rat.NR,
                        registered = false,
                        connection = CellConnection.SECONDARY_SERVING,
                        timestampMs = null,
                        arfcn = null,
                        pci = null,
                        plmn = null,
                        ci = null,
                        tac = null,
                        rsrp = -102,
                        rsrq = -12,
                        sinr = 4,
                        rssi = null,
                        rscp = null,
                        ecno = null,
                    ),
                ),
            ),
            SimReading(
                slot = 1,
                simPlmn = "72402",
                registeredPlmn = null,
                operatorName = null,
                serviceState = ServiceStatus.OUT_OF_SERVICE,
                overrideNetworkType = null,
                cells = emptyList(),
            ),
        ),
    )

    private val json = """
        {
          "schemaVersion": 2,
          "id": "6f1c0a52-3b7e-4c1d-9a8e-2d5b7c9e4f10",
          "installId": "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36",
          "sessionId": "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
          "timeMs": 1767261600000,
          "elapsedRealtimeMs": 86400000,
          "fix": {
            "lat": -15.5, "lon": -47.5, "accuracyM": 4.5, "altitudeM": 1100.0,
            "timeMs": 1767261599000, "elapsedRealtimeMs": 86399000, "mock": false
          },
          "sims": [
            {
              "slot": 0, "simPlmn": "72406", "registeredPlmn": "72406", "operatorName": "VIVO",
              "serviceState": "IN_SERVICE", "overrideNetworkType": "NR_NSA",
              "cells": [
                {"source": "CELL_INFO", "rat": "LTE", "registered": true,
                 "connection": "PRIMARY_SERVING", "timestampMs": 86399500, "arfcn": 1650,
                 "pci": 101, "plmn": "72406", "ci": 12345678, "tac": 4321, "rsrp": -98,
                 "rsrq": -11, "sinr": 7, "rssi": -67},
                {"source": "SIGNAL_STRENGTH", "rat": "NR", "registered": false,
                 "connection": "SECONDARY_SERVING", "rsrp": -102, "rsrq": -12, "sinr": 4}
              ]
            },
            {"slot": 1, "simPlmn": "72402", "serviceState": "OUT_OF_SERVICE", "cells": []}
          ]
        }
    """.trimIndent()

    @Test
    fun writesTheDocumentedNamesAndLeavesNullsOut() {
        assertEquals(JsonParser.parseString(json), gson.toJsonTree(sample))
    }

    @Test
    fun readsBackTheSameSample() {
        assertEquals(sample, gson.fromJson(gson.toJson(sample), Sample::class.java))
        assertEquals(sample, gson.fromJson(json, Sample::class.java))
    }
}
