// Aggregation of stored samples into the public map's cells (card 20261113a7do). Pure: no I/O.
import { cellToParent, greatCircleDistance, latLngToCell } from "h3-js";

/** The H3 resolution of a public map cell: edge about 29 m. */
export const CELL_RESOLUTION = 11;

/**
 * The H3 resolution of a private cell: edge about 11 m. Each one counts towards its parent public
 * cell only, which near a public cell's edge can differ from the public cell of the same point.
 */
export const PRIVATE_RESOLUTION = 12;

/** The H3 resolution of the region tile that groups public cells into one file. */
export const TILE_RESOLUTION = 5;

/**
 * How far, in metres, a session's end is cut around each place the phone may have rested at there:
 * about six public cells across, so the published track stops well short of the place.
 */
export const REST_CUT_M = 300;

/** How many distinct fixes a resting place is drawn from: a minute at the app's 5 s interval. */
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

/** How many distinct fixes outside the cut it takes for the phone to have left an end's resting places: five minutes at the app's 5 s interval. */
export const DEPARTURE_FIXES = 60;

/** A speed in m/s, 180 km/h, above any road's limit in Brazil: a step between two fixes faster than this means one of them is wrong. */
export const MAX_SPEED_MPS = 50;

/** How near, in metres, an anchor lies to the reference whose distances it reuses; see [beyondEnd]. */
const REFERENCE_M = 50;

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

/**
 * A private cell's state: one bucket per UTC month of the samples' `timeMs`, keyed "YYYY-MM".
 * Install ids, exact times and private cell ids never leave it.
 */
export type CellState = Record<string, Bucket>;

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

/** How many distances between fixes this process has computed: a measure of the trim's work that doesn't depend on the machine. */
export let distancesComputed = 0;

const metresApart = (a: StoredSample["fix"], b: StoredSample["fix"]) => {
  distancesComputed++;
  return greatCircleDistance([a.lat, a.lon], [b.lat, b.lon], "m");
};

type Anchor = { fix: StoredSample["fix"]; radiusM: number };

/**
 * Which of [samples], ordered from one end of a session inwards, lie beyond that end's cut. A
 * place the phone may rest at starts at each fix after a step longer than [REST_CUT_M] or faster
 * than [MAX_SPEED_MPS] (the fixes before it may be wrong and hide where the phone rested), and at
 * each stay of either kind in [STAYS]. The end's first fix starts none, so an end where the phone
 * was moving loses nothing. A place after a step cuts [REST_CUT_M] around each of the
 * [ANCHOR_FIXES] fixes from where it starts. A stay of radius r cuts [REST_CUT_M] + s + r / 2
 * around its first fix, s being its fixes' largest distance from that fix, which covers
 * [REST_CUT_M] around every point within r / 2 of any of its fixes. The phone has left the end
 * once [DEPARTURE_FIXES] fixes have moved: lain in no run of consecutive fixes long enough for a
 * stay, and outside the cut of every place after a step that started by then. A stay's cut
 * doesn't stop a fix moving, so rests along the way don't keep the phone from leaving. Every place that starts before
 * the phone has left is one of the end's resting places, and a sample is beyond the cut if it lies
 * outside every resting place's cut. So ten minutes of consecutive fixes within 100 m of where the
 * phone rests (or three minutes within 25 m) cut that place out, whatever wrong fixes come before
 * or among them, unless [DEPARTURE_FIXES] of those wrong fixes move.
 *
 * No fix in a run long enough for a stay moves, whichever stays the scan picks: the scan, which
 * skips the fixes of a stay it has found, either starts a stay at the run's first fix or finds it in
 * a stay that started at an earlier fix a. The run's fixes past that stay then lie within r of the
 * run's first fix, so within s + r of a. The fixes from a stay's first fix to the last one an
 * earlier stay of its kind marked are all marked as not moving, and so are the consecutive fixes
 * after both that lie within s + r of the stay's first fix; so none of the run's fixes move. Each
 * fix is tested this way once per kind of stay, plus once per stay where the marking stops.
 *
 * Consecutive samples can carry the same fix. A sample whose fix has the coordinates of the one
 * before it counts once, with it, towards [ANCHOR_FIXES] and [DEPARTURE_FIXES]. Stays and the speed
 * check count samples and their tick times: a repeat makes a run within a stay's radius longer, so
 * every run long enough for a stay without it still is one, and makes the step after it shorter in
 * time. So a repeated wrong fix neither narrows a cut nor brings departure sooner.
 */
function beyondEnd(samples: StoredSample[]): boolean[] {
  const fixes = samples.map((s) => s.fix);
  const repeat = fixes.map((fix, i) => fix.lat === fixes[i - 1]?.lat && fix.lon === fixes[i - 1]?.lon);
  const places: { from: number; anchors: Anchor[] }[] = [];
  const stays: ({ from: number } & Anchor)[] = [];
  const inStay = fixes.map(() => false);
  samples.forEach((s, i) => {
    const before = samples[i - 1];
    if (!before) return;
    const metres = metresApart(before.fix, s.fix);
    if (metres > REST_CUT_M || metres > (MAX_SPEED_MPS * Math.abs(s.elapsedRealtimeMs - before.elapsedRealtimeMs)) / 1000) {
      const anchors: Anchor[] = [];
      for (let k = i, fix = fixes[k]; fix && anchors.length < ANCHOR_FIXES; fix = fixes[++k]) {
        if (k === i || !repeat[k]) anchors.push({ fix, radiusM: REST_CUT_M });
      }
      places.push({ from: i, anchors });
    }
  });
  for (const stay of STAYS) {
    let next = 0;
    let marked = 0;
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
      stays.push({ from: i, fix: first, radiusM: REST_CUT_M + spreadM + stay.radiusM / 2 });
      inStay.fill(true, i, j);
      next = j;
      j = Math.max(j, marked);
      for (let fix = fixes[j]; fix && metresApart(first, fix) <= spreadM + stay.radiusM; fix = fixes[++j]) inStay[j] = true;
      marked = j;
    });
  }
  // Fixes in cubes of the unit sphere's space whose side is at least the widest cut's straight-line
  // length plus REFERENCE_M, so every fix within that many metres of a point lies in the point's
  // cube or the 26 next to it. 6 300 km is below the Earth's radius in h3-js, 6 371 km, which only
  // widens the cubes. A fix leaves its cube once cut.
  let widestM = REST_CUT_M;
  for (const { radiusM } of stays) widestM = Math.max(widestM, radiusM);
  const cubeOf = ({ lat, lon }: StoredSample["fix"], side: number) => {
    const [φ, λ] = [(lat * Math.PI) / 180, (lon * Math.PI) / 180];
    return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)].map((c) => Math.floor(c / side));
  };
  const side = (widestM + REFERENCE_M) / 6_300_000;
  type Entry = { k: number; fix: StoredSample["fix"] };
  const cubes = new Map<string, Entry[]>();
  fixes.forEach((fix, k) => {
    const key = cubeOf(fix, side).join();
    const cube = cubes.get(key) ?? [];
    cube.push({ k, fix });
    cubes.set(key, cube);
  });
  // The first anchor to cut in each small cube, whose side is REFERENCE_M / (2 * 6 371 km), is its
  // reference: it tests every uncut fix in its 27 cubes and keeps those it leaves, by distance from
  // it. Any later anchor in the small cube lies less than REFERENCE_M from the reference, so every
  // fix within its radius lies in the reference's 27 cubes and, by the triangle inequality, no
  // farther from the reference than their distance apart plus that radius. It tests only those
  // fixes; 1 m more covers rounding in distances of a few kilometres many times over.
  const references = new Map<string, { fix: StoredSample["fix"]; left: { metres: number; entry: Entry }[] }>();
  const beyond = fixes.map(() => true);
  const cut = ({ fix, radiusM }: Anchor) => {
    const at = cubeOf(fix, REFERENCE_M / (2 * 6_371_000)).join();
    const reference = references.get(at);
    if (reference) {
      const boundM = metresApart(reference.fix, fix) + radiusM + 1;
      for (const { metres, entry } of reference.left) {
        if (metres > boundM) break;
        if (beyond[entry.k] && metresApart(fix, entry.fix) <= radiusM) beyond[entry.k] = false;
      }
      return;
    }
    const left: { metres: number; entry: Entry }[] = [];
    const [x = 0, y = 0, z = 0] = cubeOf(fix, side);
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const key = [x + dx, y + dy, z + dz].join();
      const cube = cubes.get(key);
      if (!cube) continue;
      for (const entry of cube) {
        if (!beyond[entry.k]) continue;
        const metres = metresApart(fix, entry.fix);
        if (metres > radiusM) left.push({ metres, entry });
        else beyond[entry.k] = false;
      }
      cubes.set(key, cube.filter(({ k }) => beyond[k]));
    }
    references.set(at, { fix, left: left.sort((a, b) => a.metres - b.metres) });
  };
  let resting = 0;
  let away = 0;
  let i = 0;
  for (; i < fixes.length && away < DEPARTURE_FIXES; i++) {
    for (let place = places[resting]; place && place.from <= i; place = places[++resting]) place.anchors.forEach(cut);
    if (beyond[i] && !inStay[i] && !repeat[i]) away++;
  }
  for (const stay of stays) if (stay.from < i) cut(stay);
  return beyond;
}

/**
 * The samples of one whole session that lie beyond the cuts of both its ends, in
 * `elapsedRealtimeMs` order. Mock fixes are dropped first and count for nothing. The same samples
 * always give the same result: nothing in the trim is drawn at random.
 */
export function trimSession(session: StoredSample[]): StoredSample[] {
  const samples = session.filter((s) => !s.fix.mock).sort((a, b) => a.elapsedRealtimeMs - b.elapsedRealtimeMs);
  const fromStart = beyondEnd(samples);
  const fromEnd = beyondEnd(samples.toReversed()).toReversed();
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
 * Adds trimmed samples to [cells], keyed by the [PRIVATE_RESOLUTION] H3 cell of their fix and by
 * month. Changes [cells] in place. A SIM reading counts only when its carrier and service state
 * are known and the radio was on (`serviceState` not `POWER_OFF`); a sample with no such reading
 * adds nothing. Each such reading adds one to the count of its service state, whether its cells
 * are known or not. Only an `IN_SERVICE` reading with known cells adds a strength and a network
 * type: a modem in limited service can report the cell it is camped on as registered.
 */
export function accumulate(cells: Record<string, CellState>, samples: StoredSample[]): void {
  for (const sample of samples) {
    const sims = sample.sims.flatMap((sim) =>
      sim.simPlmn && sim.serviceState && sim.serviceState !== "POWER_OFF"
        ? [{ ...sim, plmn: sim.simPlmn }]
        : [],
    );
    if (sims.length === 0) continue;
    const months = (cells[latLngToCell(sample.fix.lat, sample.fix.lon, PRIVATE_RESOLUTION)] ??= {});
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

/** The carriers' statistics and the last sample time of the buckets combined; null when there are none. */
function merge(buckets: Bucket[]): Pick<Bucket, "lastMs" | "carriers"> | null {
  if (buckets.length === 0) return null;
  const merged: Pick<Bucket, "lastMs" | "carriers"> = { lastMs: -Infinity, carriers: {} };
  for (const b of buckets) {
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

function toPublic(h3: string, cell: Pick<Bucket, "lastMs" | "carriers">): PublicCell {
  const carriers: Record<string, PublicCarrier> = {};
  for (const [plmn, s] of Object.entries(cell.carriers)) {
    carriers[plmn] = { ...bestAndMedian(s.strengths), tech: commonTech(s.techs), serviceN: s.serviceN, emergencyN: s.emergencyN, noServiceN: s.noServiceN };
  }
  return { h3, carriers, lastSeen: monthOf(cell.lastMs) };
}

/**
 * The daily publication: a public cell for each parent of the private [cells], however many
 * installs back it, with the figures of every month of every private cell it is the parent of.
 * No input is changed.
 */
export function publish(cells: Record<string, CellState>): Record<string, PublicCell> {
  const parents: Record<string, Bucket[]> = {};
  for (const [h3, months] of Object.entries(cells)) (parents[cellToParent(h3, CELL_RESOLUTION)] ??= []).push(...Object.values(months));
  const published: Record<string, PublicCell> = {};
  for (const [h3, buckets] of Object.entries(parents)) {
    const all = merge(buckets);
    if (all) published[h3] = toPublic(h3, all);
  }
  return published;
}

/** Public cells grouped by the H3 region tile that holds them, one file per tile. */
export function tiles(published: Record<string, PublicCell>): Record<string, PublicCell[]> {
  const byTile: Record<string, PublicCell[]> = {};
  for (const cell of Object.values(published)) (byTile[cellToParent(cell.h3, TILE_RESOLUTION)] ??= []).push(cell);
  return byTile;
}
