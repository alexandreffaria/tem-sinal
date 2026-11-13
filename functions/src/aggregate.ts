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

/** How many fixes a resting place is drawn from: a minute at the app's 5 s interval. */
export const ANCHOR_FIXES = 12;

/**
 * The two kinds of stay: this many consecutive fixes within this radius in metres of the first.
 * Three minutes within 50 m is a phone at rest under open sky; ten minutes within 200 m is one at
 * rest indoors, whose fixes can be 100 m off. A walk slower than 0.33 m/s also reads as the second.
 */
export const STAYS = [
  { fixes: 36, radiusM: 50 },
  { fixes: 120, radiusM: 200 },
] as const;

/** How many fixes outside the cut it takes for the phone to have left an end's resting places: five minutes at the app's 5 s interval. */
export const DEPARTURE_FIXES = 60;

/** A speed in m/s, 180 km/h, above any road's limit in Brazil: a step between two fixes faster than this means one of them is wrong. */
export const MAX_SPEED_MPS = 50;

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

/**
 * One carrier's running statistics in a cell. Keys of `strengths` and `techs` are dBm and RAT
 * names; both come from `IN_SERVICE` readings only. `serviceN`, `emergencyN` and `noServiceN`
 * count the readings in each service state, with no overlap.
 */
export type CarrierStats = {
  strengths: Record<string, number>;
  techs: Record<string, number>;
  serviceN: number;
  emergencyN: number;
  noServiceN: number;
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

/**
 * One carrier's figures in a public cell. `best` and `median` are the strongest and the lower
 * median headline strength in dBm of the in-service readings registered to a cell, and `tech`
 * their most common network type; `best` and `median` are null when no such reading had a
 * strength, `tech` when none was registered. The counts split the readings with no overlap:
 * `serviceN` in service, `emergencyN` in emergency-only service, `noServiceN` out of service.
 */
export type PublicCarrier = {
  best: number | null;
  median: number | null;
  tech: string | null;
  serviceN: number;
  emergencyN: number;
  noServiceN: number;
};

/** A public cell: aggregates and the month last seen only. */
export type PublicCell = { h3: string; carriers: Record<string, PublicCarrier>; lastSeen: string };

/** The lengths in metres to cut from the start and the end of one session. */
export function trimLengths(random: () => number = Math.random): { startM: number; endM: number } {
  const draw = () => TRIM_M.min + random() * (TRIM_M.max - TRIM_M.min);
  return { startM: draw(), endM: draw() };
}

const metresApart = (a: StoredSample["fix"], b: StoredSample["fix"]) => greatCircleDistance([a.lat, a.lon], [b.lat, b.lon], "m");

type Anchor = { fix: StoredSample["fix"]; radiusM: number };

/**
 * Which of [samples], ordered from one end of a session inwards, lie beyond that end's cut of
 * [trimM] metres. A place the phone may rest at starts at the end's first fix, at each fix after a
 * step longer than [trimM] or faster than [MAX_SPEED_MPS] (the fixes before it may be wrong), and
 * at each stay of either kind in [STAYS]. The first two cut [trimM] around each of the
 * [ANCHOR_FIXES] fixes from where they start. A stay of radius r cuts [trimM] + s + r / 2 around
 * its first fix, s being its fixes' largest distance from that fix, which covers [trimM] around
 * every point within r / 2 of any of its fixes. The phone has left the end once [DEPARTURE_FIXES]
 * fixes have moved: lain in no stay and outside the cut of the places of the first two kinds that
 * started by then. Every place that starts before that is one of the end's resting places, and a
 * sample is beyond the cut if it lies outside every resting place's cut. So ten minutes of
 * consecutive fixes within 100 m of where the phone rests (or three minutes within 25 m) cut that place
 * out, whatever wrong fixes come before or among them, unless [DEPARTURE_FIXES] of those wrong
 * fixes move.
 */
function beyondEnd(samples: StoredSample[], trimM: number): boolean[] {
  const fixes = samples.map((s) => s.fix);
  const places: { from: number; stay: boolean; anchors: Anchor[] }[] = [];
  const inStay = fixes.map(() => false);
  samples.forEach((s, i) => {
    const before = samples[i - 1];
    const metres = before ? metresApart(before.fix, s.fix) : Infinity;
    if (metres > trimM || metres > (MAX_SPEED_MPS * Math.abs(s.elapsedRealtimeMs - (before?.elapsedRealtimeMs ?? 0))) / 1000) {
      places.push({ from: i, stay: false, anchors: fixes.slice(i, i + ANCHOR_FIXES).map((fix) => ({ fix, radiusM: trimM })) });
    }
  });
  for (const stay of STAYS) {
    let next = 0;
    fixes.forEach((first, i) => {
      if (i < next) return;
      let j = i + 1;
      let spreadM = 0;
      for (let fix = fixes[j]; fix; fix = fixes[++j]) {
        const metres = metresApart(first, fix);
        if (metres > stay.radiusM) break;
        spreadM = Math.max(spreadM, metres);
      }
      if (j - i < stay.fixes) return;
      places.push({ from: i, stay: true, anchors: [{ fix: first, radiusM: trimM + spreadM + stay.radiusM / 2 }] });
      inStay.fill(true, i, j);
      next = j;
    });
  }
  places.sort((a, b) => a.from - b.from);
  // Fixes in cubes of the unit sphere's space whose side is at least the widest cut's straight-line
  // length, so a cut reaches only fixes in its own cube and the 26 next to it. A fix leaves a cube's
  // [uncut] once cut and its [moving] once it no longer moves, so no cut tests it again.
  let widestM = 0;
  for (const place of places) for (const { radiusM } of place.anchors) widestM = Math.max(widestM, radiusM);
  // 6 300 km is below the Earth's radius in h3-js, 6 371 km, which only widens the cubes.
  const side = widestM / 6_300_000;
  const cubeOf = ({ lat, lon }: StoredSample["fix"]) => {
    const [φ, λ] = [(lat * Math.PI) / 180, (lon * Math.PI) / 180];
    return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)].map((c) => Math.floor(c / side));
  };
  type Entry = { k: number; fix: StoredSample["fix"] };
  const cubes = new Map<string, { uncut: Entry[]; moving: Entry[] }>();
  fixes.forEach((fix, k) => {
    const key = cubeOf(fix).join();
    const cube = cubes.get(key) ?? { uncut: [], moving: [] };
    cube.uncut.push({ k, fix });
    if (!inStay[k]) cube.moving.push({ k, fix });
    cubes.set(key, cube);
  });
  const beyond = fixes.map(() => true);
  const moving = fixes.map((_, i) => !inStay[i]);
  let resting = 0;
  let away = 0;
  for (let i = 0; i < fixes.length && away < DEPARTURE_FIXES; i++) {
    for (let place = places[resting]; place && place.from <= i; place = places[++resting]) {
      for (const { fix, radiusM } of place.anchors) {
        const outside = (entry: Entry) => metresApart(fix, entry.fix) > radiusM;
        const [x = 0, y = 0, z = 0] = cubeOf(fix);
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
          const cube = cubes.get([x + dx, y + dy, z + dz].join());
          if (!cube) continue;
          for (const entry of cube.uncut) if (!outside(entry)) beyond[entry.k] = false;
          cube.uncut = cube.uncut.filter(({ k }) => beyond[k]);
          if (place.stay) continue;
          for (const entry of cube.moving) if (!outside(entry)) moving[entry.k] = false;
          cube.moving = cube.moving.filter(({ k }) => moving[k]);
        }
      }
    }
    if (moving[i]) away++;
  }
  return beyond;
}

/**
 * The samples of one whole session that lie beyond the cut of [startM] metres at its first end and
 * of [endM] at its last, in `elapsedRealtimeMs` order. Mock fixes are dropped first and count for
 * nothing.
 */
export function trimSession(session: StoredSample[], startM: number, endM: number): StoredSample[] {
  const samples = session.filter((s) => !s.fix.mock).sort((a, b) => a.elapsedRealtimeMs - b.elapsedRealtimeMs);
  const fromStart = beyondEnd(samples, startM);
  const fromEnd = beyondEnd(samples.toReversed(), endM).toReversed();
  return samples.filter((_, i) => fromStart[i] && fromEnd[i]);
}

/** The headline strength of a registered cell: RSRP for LTE and NR, RSCP for WCDMA, RSSI for GSM. */
function headline(cell: NonNullable<StoredSample["sims"][number]["cells"]>[number]): number | null {
  if (cell.rat === "LTE" || cell.rat === "NR") return cell.rsrp ?? null;
  if (cell.rat === "WCDMA") return cell.rscp ?? null;
  return cell.rssi ?? null;
}

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/**
 * Adds trimmed samples to [cells], keyed by H3 cell and month. Changes [cells] in place. A SIM
 * reading counts only when its carrier and service state are known and the radio was on
 * (`serviceState` not `POWER_OFF`); a sample with no such reading adds nothing. Each such reading
 * adds one to the count of its service state, whether its cells are known or not. Only an
 * `IN_SERVICE` reading with known cells adds a strength and a network type: a modem in limited
 * service can report the cell it is camped on as registered.
 */
export function accumulate(cells: Record<string, CellState>, samples: StoredSample[]): void {
  for (const sample of samples) {
    const sims = sample.sims.flatMap((sim) =>
      sim.simPlmn && sim.serviceState && sim.serviceState !== "POWER_OFF"
        ? [{ ...sim, plmn: sim.simPlmn }]
        : [],
    );
    if (sims.length === 0) continue;
    const h3 = latLngToCell(sample.fix.lat, sample.fix.lon, CELL_RESOLUTION);
    const months = (cells[h3] ??= { months: {}, held: false }).months;
    const cell = (months[monthOf(sample.timeMs)] ??= { installs: [], firstMs: sample.timeMs, lastMs: sample.timeMs, carriers: {} });
    if (!cell.installs.includes(sample.installId)) cell.installs.push(sample.installId);
    cell.firstMs = Math.min(cell.firstMs, sample.timeMs);
    cell.lastMs = Math.max(cell.lastMs, sample.timeMs);
    for (const sim of sims) {
      const stats = (cell.carriers[sim.plmn] ??= { strengths: {}, techs: {}, serviceN: 0, emergencyN: 0, noServiceN: 0 });
      if (sim.serviceState === "EMERGENCY_ONLY") stats.emergencyN++;
      else if (sim.serviceState === "OUT_OF_SERVICE") stats.noServiceN++;
      else stats.serviceN++;
      if (sim.serviceState !== "IN_SERVICE" || !sim.cells) continue;
      const registered = sim.cells.find((c) => c.source === "CELL_INFO" && c.registered);
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
      const m = (merged.carriers[plmn] ??= { strengths: {}, techs: {}, serviceN: 0, emergencyN: 0, noServiceN: 0 });
      for (const [dbm, count] of Object.entries(s.strengths)) m.strengths[dbm] = (m.strengths[dbm] ?? 0) + count;
      for (const [rat, count] of Object.entries(s.techs)) m.techs[rat] = (m.techs[rat] ?? 0) + count;
      m.serviceN += s.serviceN;
      m.emergencyN += s.emergencyN;
      m.noServiceN += s.noServiceN;
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
    carriers[plmn] = { ...bestAndMedian(s.strengths), tech: commonTech(s.techs), serviceN: s.serviceN, emergencyN: s.emergencyN, noServiceN: s.noServiceN };
  }
  return { h3, carriers, lastSeen: monthOf(cell.lastMs) };
}

/**
 * The daily publication at [nowMs]: the public cells from the previous publication, updated by
 * the rule of card 20261113a7do. A cell backed by two or more installs that was never held is
 * updated every day. Any other cell changes only in the monthly batch (UTC): a single-install cell
 * once its first sample is at least [LONE_CELL_AGE_MS] old, a held cell that has since gained a
 * second install at once. The batch runs in the first publication of a month later than
 * [lastBatch], the month ("YYYY-MM") of the previous batch or null if there was none, so a missed
 * run on the 1st doesn't delay it a month. Run later than the 1st, it publishes only what a run
 * at the end of the 1st would: a cell's age is measured at that time at the latest, and a batch
 * publishes such a cell from its samples before the batch's month only, so a lone visit shows as
 * no more than its month. Returns the new private state, with `held` set for cells that wait, the
 * new public cells and the month of the latest batch; no input is changed. Throws, publishing
 * nothing, when [lastBatch] doesn't fit the state: null while [previous] holds cells (every
 * publication runs a batch when there was none, so a second batch would run in its month), or a
 * month later than [nowMs]'s (no batch would run until after it).
 */
export function publish(
  cells: Record<string, CellState>,
  previous: Record<string, PublicCell>,
  lastBatch: string | null,
  nowMs: number,
): { cells: Record<string, CellState>; published: Record<string, PublicCell>; lastBatch: string | null } {
  const month = monthOf(nowMs);
  if (lastBatch === null && Object.keys(previous).length > 0) {
    throw new Error("publish: no previous batch, but public cells exist");
  }
  if (lastBatch !== null && lastBatch > month) {
    throw new Error(`publish: previous batch ${lastBatch} is later than ${month}`);
  }
  const batch = lastBatch === null || month > lastBatch;
  const now = new Date(nowMs);
  const ageAtMs = Math.min(nowMs, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2) - 1);
  const nextCells: Record<string, CellState> = {};
  const published: Record<string, PublicCell> = { ...previous };
  for (const [h3, cell] of Object.entries(cells)) {
    const all = merge(Object.values(cell.months));
    if (!all) continue;
    const shared = all.installs.length >= 2;
    let held = cell.held || (!shared && !previous[h3]);
    if (shared && !held) {
      published[h3] = toPublic(h3, all);
    } else if (batch) {
      const before = merge(Object.entries(cell.months).filter(([m]) => m < month).map(([, b]) => b));
      if (before && (shared || ageAtMs - before.firstMs >= LONE_CELL_AGE_MS)) {
        published[h3] = toPublic(h3, before);
        held = false;
      }
    }
    nextCells[h3] = { ...cell, held };
  }
  return { cells: nextCells, published, lastBatch: batch ? month : lastBatch };
}

/** Public cells grouped by the H3 region tile that holds them, one file per tile. */
export function tiles(published: Record<string, PublicCell>): Record<string, PublicCell[]> {
  const byTile: Record<string, PublicCell[]> = {};
  for (const cell of Object.values(published)) (byTile[cellToParent(cell.h3, TILE_RESOLUTION)] ??= []).push(cell);
  return byTile;
}
