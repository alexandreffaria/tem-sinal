// How the map labels one carrier in one cell, from the cell's published counts.

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
