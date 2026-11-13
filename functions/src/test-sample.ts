import { randomUUID } from "node:crypto";

/** The made-up install every [testSample] comes from. */
export const INSTALL_ID = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36";

/**
 * A new valid sample at an invented place, shaped like the example in docs/sample-schema.md, with
 * a fresh random id: a dual-SIM phone with SIM 1 in 5G NSA and SIM 2 out of service.
 */
export function testSample(): Record<string, unknown> & { id: string } {
  return {
    schemaVersion: 2,
    id: randomUUID(),
    installId: INSTALL_ID,
    sessionId: "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28",
    timeMs: 1767261600000,
    elapsedRealtimeMs: 86400000,
    fix: {
      lat: -15.5, lon: -47.5, accuracyM: 4.5, altitudeM: 1100.0,
      verticalAccuracyM: 6.0, timeMs: 1767261599000, elapsedRealtimeMs: 86399000, mock: false,
    },
    sims: [
      {
        slot: 0, simPlmn: "72406", registeredPlmn: "72406", operatorName: "VIVO",
        serviceState: "IN_SERVICE", overrideNetworkType: "NR_NSA",
        cells: [
          { source: "CELL_INFO", rat: "LTE", registered: true, connection: "PRIMARY_SERVING",
            timestampMs: 86399500, arfcn: 1650, pci: 101, plmn: "72406", ci: 12345678,
            tac: 4321, rsrp: -98, rsrq: -11, sinr: 7, rssi: -67 },
          { source: "CELL_INFO", rat: "LTE", registered: false, connection: "NONE",
            timestampMs: 86399500, arfcn: 1650, pci: 205, rsrp: -109, rsrq: -15 },
          { source: "SIGNAL_STRENGTH", rat: "NR", registered: false,
            connection: "SECONDARY_SERVING", rsrp: -102, rsrq: -12, sinr: 4 },
        ],
      },
      { slot: 1, simPlmn: "72402", serviceState: "OUT_OF_SERVICE", cells: [] },
    ],
  };
}
