// How the map labels and shades one carrier in one cell, from the cell's published figures.

/** The share of a cell's readings that signal, or emergency calls with signal counted in, must reach. */
export const RELIABLE_SHARE = 0.9;

/**
 * "signal" when in-service readings are at least RELIABLE_SHARE of the total; else "emergency"
 * when in-service and emergency-only readings together are (a phone in service can call emergency
 * too); else "none".
 */
export function label({ serviceN, emergencyN, noServiceN }) {
  const total = serviceN + emergencyN + noServiceN;
  if (serviceN >= RELIABLE_SHARE * total) return "signal";
  if (serviceN + emergencyN >= RELIABLE_SHARE * total) return "emergency";
  return "none";
}

/**
 * Android's default signal level thresholds for each network type, in dBm of the headline strength
 * the server publishes (LEVEL_THRESHOLDS in functions/src/aggregate.ts): the lowest strength of
 * levels 1 (poor) to 4 (great), from the defaults of CarrierConfigManager. LTE is
 * KEY_LTE_RSRP_THRESHOLDS_INT_ARRAY, NR KEY_5G_NR_SSRSRP_THRESHOLDS_INT_ARRAY, WCDMA
 * KEY_WCDMA_RSCP_THRESHOLDS_INT_ARRAY and GSM KEY_GSM_RSSI_THRESHOLDS_INT_ARRAY.
 */
export const LEVEL_THRESHOLDS = {
  LTE: [-128, -118, -108, -98],
  NR: [-110, -90, -80, -65],
  WCDMA: [-115, -105, -95, -85],
  GSM: [-107, -103, -97, -89],
};

/**
 * The signal level, 0 (none or unknown to Android) to 4 (great), of a carrier's median strength
 * for its network type, as Android counts it: the number of thresholds the strength reaches. Null
 * when the median or the type is unknown, or the type has no thresholds.
 */
export function level({ median, tech }) {
  if (median === null || !Object.hasOwn(LEVEL_THRESHOLDS, tech)) return null;
  return LEVEL_THRESHOLDS[tech].filter((threshold) => median >= threshold).length;
}

/** The shade of a cell with signal at [signalLevel]: "signal-0" to "signal-4", or "signal-unknown". */
const signalShade = (signalLevel) => (signalLevel === null ? "signal-unknown" : `signal-${signalLevel}`);

/** How the map colours a carrier in a public cell: its label, and for signal its median's level. */
export function shade(figures) {
  const which = label(figures);
  return which === "signal" ? signalShade(level(figures)) : which;
}

/**
 * How the map colours a carrier in an overview cell, from its counts of the public cells inside
 * it (OverviewCell in functions/src/aggregate.ts): the best label of any of them, and for signal
 * the best level of any of them with signal, or "signal-unknown" when none of those has a level.
 */
export function coarseShade([signal, emergency, , ...levels]) {
  if (signal > 0) {
    const best = levels.findLastIndex((n) => n > 0);
    return signalShade(best < 0 ? null : best);
  }
  return emergency > 0 ? "emergency" : "none";
}
