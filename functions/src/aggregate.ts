// Aggregation of stored samples into the public map's cells (card 20261113a7do). Pure: no I/O.
import { cellToParent, greatCircleDistance, latLngToCell } from "h3-js";

/** The H3 resolution of a public map cell: edge about 29 m. */
export const CELL_RESOLUTION = 11;

/** The H3 resolution of the region tile that groups public cells into one file. */
export const TILE_RESOLUTION = 5;

/** The range of the length, in metres, cut from each end of a session; drawn per session and end. */
export const TRIM_M = { min: 300, max: 800 } as const;

/** How old a single-install cell's first sample must be before a monthly batch publishes it. */
export const LONE_CELL_AGE_MS = 30 * 86_400_000;

/** The fields of a stored sample (docs/sample-schema.md) that aggregation reads. */
export type StoredSample = {
  installId: string;
  sessionId: string;
  timeMs: number;
  elapsedRealtimeMs: number;
  fix: { lat: number; lon: number; mock: boolean };
  sims: {
    simPlmn?: string | null;
    serviceState?: string | null;
    cells?: { source: string; rat: string; registered: boolean; rsrp?: number | null; rscp?: number | null; rssi?: number | null }[] | null;
  }[];
};

/** One carrier's running statistics in a cell. Keys of `strengths` and `techs` are dBm and RAT names. */
export type CarrierStats = {
  strengths: Record<string, number>;
  techs: Record<string, number>;
  emergencyOnlySeen: boolean;
  n: number;
};

/** The statistics of a cell's samples, with the installs and the first and last sample times. */
export type Bucket = {
  installs: string[];
  firstMs: number;
  lastMs: number;
  carriers: Record<string, CarrierStats>;
};

/** A cell's private state: install ids and exact times never leave it. */
export type CellState = {
  /** One bucket per UTC month of the samples' `timeMs`, keyed "YYYY-MM". */
  months: Record<string, Bucket>;
  /** Seen by one install while unpublished; only a monthly batch publishes it. */
  held: boolean;
};

export type PublicCarrier = { best: number | null; median: number | null; tech: string | null; n: number; emergencyOnlySeen: boolean };

/** A public cell: aggregates and the month last seen only. */
export type PublicCell = { h3: string; carriers: Record<string, PublicCarrier>; lastSeen: string };

/** The lengths in metres to cut from the start and the end of one session. */
export function trimLengths(random: () => number = Math.random): { startM: number; endM: number } {
  const draw = () => TRIM_M.min + random() * (TRIM_M.max - TRIM_M.min);
  return { startM: draw(), endM: draw() };
}

/**
 * The samples of one whole session that lie more than [startM] metres from its first fix and more
 * than [endM] from its last, both along its path and in a straight line, in `elapsedRealtimeMs`
 * order. The straight-line cut holds where GPS jitter uses up the path while the phone sits
 * still. Mock fixes are dropped first and count for neither the path nor the result.
 */
export function trimSession(session: StoredSample[], startM: number, endM: number): StoredSample[] {
  const samples = session.filter((s) => !s.fix.mock).sort((a, b) => a.elapsedRealtimeMs - b.elapsedRealtimeMs);
  let total = 0;
  let previous: StoredSample["fix"] | undefined;
  const along = samples.map(({ fix }) => {
    if (previous) total += greatCircleDistance([previous.lat, previous.lon], [fix.lat, fix.lon], "m");
    previous = fix;
    return total;
  });
  const first = samples[0]?.fix;
  const last = samples.at(-1)?.fix;
  const from = (end: StoredSample["fix"] | undefined, fix: StoredSample["fix"]) =>
    end ? greatCircleDistance([end.lat, end.lon], [fix.lat, fix.lon], "m") : 0;
  return samples.filter(({ fix }, i) => {
    const metres = along[i] ?? 0;
    return metres > startM && total - metres > endM && from(first, fix) > startM && from(last, fix) > endM;
  });
}

/** The headline strength of a registered cell: RSRP for LTE and NR, RSCP for WCDMA, RSSI for GSM. */
function headline(cell: NonNullable<StoredSample["sims"][number]["cells"]>[number]): number | null {
  if (cell.rat === "LTE" || cell.rat === "NR") return cell.rsrp ?? null;
  if (cell.rat === "WCDMA") return cell.rscp ?? null;
  return cell.rssi ?? null;
}

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** Adds trimmed samples to [cells], keyed by H3 cell and month. Changes [cells] in place. */
export function accumulate(cells: Record<string, CellState>, samples: StoredSample[]): void {
  for (const sample of samples) {
    const h3 = latLngToCell(sample.fix.lat, sample.fix.lon, CELL_RESOLUTION);
    const months = (cells[h3] ??= { months: {}, held: false }).months;
    const cell = (months[monthOf(sample.timeMs)] ??= { installs: [], firstMs: sample.timeMs, lastMs: sample.timeMs, carriers: {} });
    if (!cell.installs.includes(sample.installId)) cell.installs.push(sample.installId);
    cell.firstMs = Math.min(cell.firstMs, sample.timeMs);
    cell.lastMs = Math.max(cell.lastMs, sample.timeMs);
    for (const sim of sample.sims) {
      if (!sim.simPlmn) continue;
      const stats = (cell.carriers[sim.simPlmn] ??= { strengths: {}, techs: {}, emergencyOnlySeen: false, n: 0 });
      stats.n++;
      if (sim.serviceState === "EMERGENCY_ONLY") stats.emergencyOnlySeen = true;
      const registered = sim.cells?.find((c) => c.source === "CELL_INFO" && c.registered);
      if (!registered) continue;
      stats.techs[registered.rat] = (stats.techs[registered.rat] ?? 0) + 1;
      const dbm = headline(registered);
      if (dbm !== null) stats.strengths[dbm] = (stats.strengths[dbm] ?? 0) + 1;
    }
  }
}

/** The buckets combined into one; null when there are none. */
function merge(buckets: Bucket[]): Bucket | null {
  if (buckets.length === 0) return null;
  const merged: Bucket = { installs: [], firstMs: Infinity, lastMs: -Infinity, carriers: {} };
  for (const b of buckets) {
    merged.installs = [...new Set([...merged.installs, ...b.installs])];
    merged.firstMs = Math.min(merged.firstMs, b.firstMs);
    merged.lastMs = Math.max(merged.lastMs, b.lastMs);
    for (const [plmn, s] of Object.entries(b.carriers)) {
      const m = (merged.carriers[plmn] ??= { strengths: {}, techs: {}, emergencyOnlySeen: false, n: 0 });
      for (const [dbm, count] of Object.entries(s.strengths)) m.strengths[dbm] = (m.strengths[dbm] ?? 0) + count;
      for (const [rat, count] of Object.entries(s.techs)) m.techs[rat] = (m.techs[rat] ?? 0) + count;
      m.emergencyOnlySeen ||= s.emergencyOnlySeen;
      m.n += s.n;
    }
  }
  return merged;
}

/** The best and the lower median of a histogram of dBm values; null when it is empty. */
function bestAndMedian(histogram: Record<string, number>): { best: number | null; median: number | null } {
  const entries = Object.entries(histogram).map(([dbm, count]) => [Number(dbm), count] as const);
  entries.sort((a, b) => a[0] - b[0]);
  const half = Math.ceil(entries.reduce((sum, [, count]) => sum + count, 0) / 2);
  let seen = 0;
  const median = entries.find(([, count]) => (seen += count) >= half)?.[0] ?? null;
  return { best: entries.at(-1)?.[0] ?? null, median };
}

/** The technology seen most often; a tie goes to the newer one. */
function commonTech(techs: Record<string, number>): string | null {
  const order = ["NR", "LTE", "WCDMA", "GSM"];
  const ranked = Object.entries(techs).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  return ranked[0]?.[0] ?? null;
}

function toPublic(h3: string, cell: Bucket): PublicCell {
  const carriers: Record<string, PublicCarrier> = {};
  for (const [plmn, s] of Object.entries(cell.carriers)) {
    carriers[plmn] = { ...bestAndMedian(s.strengths), tech: commonTech(s.techs), n: s.n, emergencyOnlySeen: s.emergencyOnlySeen };
  }
  return { h3, carriers, lastSeen: monthOf(cell.lastMs) };
}

/**
 * The daily publication at [nowMs]: the public cells from the previous publication, updated by
 * the rule of card 20261113a7do. A cell backed by two or more installs that was never held is
 * updated every day. Any other cell changes only in the batch on the 1st of the month (UTC): a
 * single-install cell once its first sample is at least [LONE_CELL_AGE_MS] old, a held cell that
 * has since gained a second install at once. A batch publishes such a cell from its samples before
 * the batch's month only, so a lone visit shows as no more than its month. Returns the new private state, with `held` set for
 * cells that wait, and the new public cells; neither input is changed.
 */
export function publish(
  cells: Record<string, CellState>,
  previous: Record<string, PublicCell>,
  nowMs: number,
): { cells: Record<string, CellState>; published: Record<string, PublicCell> } {
  const batch = new Date(nowMs).getUTCDate() === 1;
  const nextCells: Record<string, CellState> = {};
  const published: Record<string, PublicCell> = { ...previous };
  const month = monthOf(nowMs);
  for (const [h3, cell] of Object.entries(cells)) {
    const all = merge(Object.values(cell.months));
    if (!all) continue;
    const shared = all.installs.length >= 2;
    let held = cell.held || (!shared && !previous[h3]);
    if (shared && !held) {
      published[h3] = toPublic(h3, all);
    } else if (batch) {
      const before = merge(Object.entries(cell.months).filter(([m]) => m < month).map(([, b]) => b));
      if (before && (shared || nowMs - before.firstMs >= LONE_CELL_AGE_MS)) {
        published[h3] = toPublic(h3, before);
        held = false;
      }
    }
    nextCells[h3] = { ...cell, held };
  }
  return { cells: nextCells, published };
}

/** Public cells grouped by the H3 region tile that holds them, one file per tile. */
export function tiles(published: Record<string, PublicCell>): Record<string, PublicCell[]> {
  const byTile: Record<string, PublicCell[]> = {};
  for (const cell of Object.values(published)) (byTile[cellToParent(cell.h3, TILE_RESOLUTION)] ??= []).push(cell);
  return byTile;
}
