import assert from "node:assert/strict";
import { test } from "node:test";
import { cellToParent, greatCircleDistance, latLngToCell } from "h3-js";
import {
  type CellState, type PublicCell, type StoredSample,
  ANCHOR_FIXES, CELL_RESOLUTION, DEPARTURE_FIXES, STAY_M, TILE_RESOLUTION, TRIM_M, accumulate, publish, tiles, trimLengths, trimSession,
} from "./aggregate.js";

// Made-up installs, sessions and places; 0.001 degrees of latitude is about 111 m.
const ALICE = "0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36";
const BRUNO = "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67";
const SESSION = "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28";
const PLACE = { lat: -15.5, lon: -47.5 };
const JAN_10 = Date.UTC(2026, 0, 10, 13);
const DAY = 86_400_000;

function sample(installId: string, lat: number, timeMs: number, options: Partial<StoredSample> = {}): StoredSample {
  return {
    installId, sessionId: SESSION, timeMs, elapsedRealtimeMs: timeMs - JAN_10 + 1_000_000,
    fix: { lat, lon: PLACE.lon, mock: false },
    sims: [
      {
        simPlmn: "72406", serviceState: "IN_SERVICE",
        cells: [
          { source: "CELL_INFO", rat: "LTE", registered: true, rsrp: -98 },
          { source: "CELL_INFO", rat: "LTE", registered: false, rsrp: -80 },
        ],
      },
      { simPlmn: "72402", serviceState: "EMERGENCY_ONLY", cells: null },
    ],
    ...options,
  };
}

const h3At = (lat: number) => latLngToCell(lat, PLACE.lon, CELL_RESOLUTION);

/** The public cells after one publication per listed day, each on the samples given before it. */
function publishOn(cells: Record<string, CellState>, days: number[]): Record<string, PublicCell>[] {
  let published: Record<string, PublicCell> = {};
  return days.map((day) => {
    ({ cells, published } = publish(cells, published, day));
    return published;
  });
}

/** A walk north from [PLACE] with a fix every 5 s, about 10 m apart. */
const walk = (length: number) =>
  Array.from({ length }, (_, i) => sample(ALICE, PLACE.lat + i * 0.00009, JAN_10 + i * 5_000));

/** [length] fixes 30 s apart from [from] 30 s steps on, still within about 10 m of [lat]. */
const still = (lat: number, from: number, length = 360) =>
  Array.from({ length }, (_, i) => sample(ALICE, lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + (from + i) * 30_000));

/** Asserts that [kept] is not empty and that none of it lies within [trimM] of the latitudes [places]. */
function assertClear(kept: StoredSample[], places: number[], trimM: number, message?: string) {
  assert.ok(kept.length > 0, message);
  for (const { fix } of kept) {
    for (const lat of places) assert.ok(greatCircleDistance([lat, PLACE.lon], [fix.lat, fix.lon], "m") > trimM, message);
  }
}

test("a session loses the samples within its trim lengths of either end and of the fixes there", () => {
  const fixes = walk(401);
  const kept = trimSession(fixes.toReversed(), 555, 345);
  // The first and last ANCHOR_FIXES fixes (about 110 m) widen each straight-line cut by their spread.
  assert.equal(ANCHOR_FIXES, 12);
  assert.deepEqual(kept, fixes.slice(67, 355));

  const cells: Record<string, CellState> = {};
  accumulate(cells, kept);
  for (const end of [...fixes.slice(0, 50), ...fixes.slice(-30)]) assert.equal(cells[h3At(end.fix.lat)], undefined);
});

test("a phone left still at either end loses those samples despite GPS jitter", () => {
  // Three hours still at each end, a fix every 30 s within about 10 m, and a 3 km walk between.
  const end = PLACE.lat + 0.027;
  const between = Array.from({ length: 30 }, (_, i) => sample(ALICE, PLACE.lat + (i + 1) * 0.0009, JAN_10 + (360 + i) * 30_000));
  assertClear(trimSession([...still(PLACE.lat, 0), ...between, ...still(end, 390)], TRIM_M.max, TRIM_M.max), [PLACE.lat, end], TRIM_M.max);
});

test("wrong fixes at either end don't stand in for the place the phone rests", () => {
  // A fix every 5 s, latitudes listed; 1 degree of latitude is about 111 195 m.
  const session = (pieces: number[][]) => pieces.flat().map((lat, i) => sample(ALICE, lat, JAN_10 + i * 5_000));
  const repeat = (length: number, lat: number) => Array.from({ length }, () => lat);
  const hour = (lat: number) => Array.from({ length: 720 }, (_, i) => lat + 0.00009 * Math.sin(i * 1.7));
  const end = PLACE.lat + 0.027;
  const out = Array.from({ length: 300 }, (_, i) => PLACE.lat + (i + 1) * 0.00009);
  // The fixes strictly between [from] and [to], a twentieth of the way apart.
  const glide = (from: number, to: number) => Array.from({ length: 19 }, (_, i) => from + ((i + 1) * (to - from)) / 20);
  for (const trimM of [TRIM_M.min, TRIM_M.max]) {
    const off = (1.3 * trimM) / 111_195;
    const cases = {
      // Twelve repeats of a network fix 1.3 trims off, then an hour still with jitter, at each end.
      network: session([repeat(ANCHOR_FIXES, PLACE.lat - off), hour(PLACE.lat), out, hour(end), repeat(ANCHOR_FIXES, end + off)]),
      // An hour of Wi-Fi fixes 1 km off, then GPS at the door and the walk at once, at each end.
      wifi: session([repeat(720, PLACE.lat - 0.009), out, repeat(720, end + 0.009)]),
      // Ten minutes of scattered fixes 1.2 km off, ten minutes without a fix, then an hour still.
      scattered: [
        ...session([Array.from({ length: 120 }, (_, i) => PLACE.lat - 0.011 + 0.004 * Math.sin(i))]),
        ...session([hour(PLACE.lat), out, hour(end)]).map((s) => ({ ...s, elapsedRealtimeMs: s.elapsedRealtimeMs + 1_200_000 })),
      ],
      // Ten minutes of fixes 1.2 km off, ten minutes without a fix, then GPS at the door and the walk at once.
      gap: [
        ...session([repeat(120, PLACE.lat - 0.011)]),
        ...session([out, repeat(120, end + 0.011)]).map((s) => ({ ...s, elapsedRealtimeMs: s.elapsedRealtimeMs + 1_200_000 })),
      ],
      // One fix 1.2 km off, then an hour still, at each end.
      single: session([[PLACE.lat - 0.011], hour(PLACE.lat), out, hour(end), [end + 0.011]]),
      // Ten minutes 1 km off, a 100 s glide home in 50 m steps (36 km/h), ten minutes still, at each end.
      glide: session([
        repeat(120, PLACE.lat - 0.009), glide(PLACE.lat - 0.009, PLACE.lat), hour(PLACE.lat).slice(0, 120), out,
        hour(end).slice(0, 120), glide(end + 0.009, end).toReversed(), repeat(120, end + 0.009),
      ]),
    };
    for (const [name, s] of Object.entries(cases)) assertClear(trimSession(s, trimM, trimM), [PLACE.lat, end], trimM, `${name} ${trimM}`);
  }
});

test("a stay is cut out unless the phone first moves away from the end for DEPARTURE_FIXES", () => {
  // Ten minutes still, a walk north at 2 m/s to a crag [metres] away, two hours there, the walk back, ten minutes still.
  const session = (metres: number) => {
    const walkOut = Array.from({ length: metres / 10 - 1 }, (_, i) => (i + 1) * 10);
    const ms = [...Array(120).fill(0), ...walkOut, ...Array(1440).fill(metres), ...walkOut.toReversed(), ...Array(120).fill(0)];
    return ms.map((m: number, i) => sample(ALICE, PLACE.lat + m / 111_195, JAN_10 + i * 5_000));
  };
  const atCrag = (metres: number) =>
    trimSession(session(metres), TRIM_M.max, TRIM_M.max).filter((s) => s.fix.lat === PLACE.lat + metres / 111_195).length;
  // The walk leaves the cut of the end's first fixes 800 m out, and DEPARTURE_FIXES at 2 m/s take it
  // 600 m further; the crag's stay starts STAY_M short of it.
  assert.deepEqual([DEPARTURE_FIXES, STAY_M], [60, 50]);
  assert.equal(atCrag(1400), 0);
  assert.equal(atCrag(1500), 1440);
});

test("a step faster than any phone moves after an end's cut doesn't restart it", () => {
  const fixes = walk(401);
  // One fix 1 km off in the middle: two steps longer than either trim, both after the cuts.
  fixes[200] = { ...sample(ALICE, PLACE.lat + 200 * 0.00009, JAN_10 + 200 * 5_000), fix: { lat: PLACE.lat, lon: PLACE.lon + 0.01, mock: false } };
  assert.deepEqual(trimSession(fixes, 555, 345), fixes.slice(67, 355));
});

test("mock fixes are dropped and a session shorter than both trims keeps nothing", () => {
  const fixes = walk(211);
  const mocked = { ...fixes[105], fix: { lat: PLACE.lat + 0.009, lon: PLACE.lon, mock: true } } as StoredSample;
  fixes[105] = mocked;
  const kept = trimSession(fixes, 355, 355);
  assert.equal(kept.includes(mocked), false);
  assert.deepEqual(kept, [...fixes.slice(47, 105), ...fixes.slice(106, 164)]);
  assert.deepEqual(trimSession(fixes, 1100, 1100), []);
});

test("trim lengths are drawn in the configured range", () => {
  assert.deepEqual(trimLengths(() => 0), { startM: TRIM_M.min, endM: TRIM_M.min });
  const values = [0.25, 0.999];
  const { startM, endM } = trimLengths(() => values.shift() ?? 0);
  assert.equal(startM, TRIM_M.min + 0.25 * (TRIM_M.max - TRIM_M.min));
  assert.ok(endM < TRIM_M.max && endM > startM);
});

test("a two-install cell is public the next day with per-carrier aggregates only", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [
    sample(ALICE, PLACE.lat, JAN_10),
    sample(ALICE, PLACE.lat, JAN_10 + 60_000, {
      sims: [{ simPlmn: "72406", serviceState: "IN_SERVICE", cells: [{ source: "CELL_INFO", rat: "NR", registered: true, rsrp: -90 }] }],
    }),
    sample(BRUNO, PLACE.lat, JAN_10 + 120_000),
  ]);
  const [nextDay = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(nextDay, {
    [h3At(PLACE.lat)]: {
      h3: h3At(PLACE.lat),
      carriers: {
        "72406": { best: -90, median: -98, tech: "LTE", n: 3, emergencyOnlySeen: false },
        "72402": { best: null, median: null, tech: null, n: 2, emergencyOnlySeen: true },
      },
      lastSeen: "2026-01",
    },
  });
  const text = JSON.stringify(tiles(nextDay));
  for (const secret of [ALICE, BRUNO, SESSION, String(JAN_10), String(JAN_10 + 120_000), String(PLACE.lat)]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("a one-install cell waits for a monthly batch at least 30 days after its first sample", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  const days = [JAN_10 + DAY, Date.UTC(2026, 1, 1, 6), Date.UTC(2026, 1, 2, 6), Date.UTC(2026, 2, 1, 6)];
  const [nextDay, febBatch, febSecond, marBatch = {}] = publishOn(cells, days);
  assert.deepEqual([nextDay, febBatch, febSecond], [{}, {}, {}]);
  assert.deepEqual(Object.keys(marBatch), [h3At(PLACE.lat)]);
});

test("a held cell that gains a second install still waits for the next batch", () => {
  let cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  ({ cells, published } = publish(cells, {}, JAN_10 + DAY));
  accumulate(cells, [sample(BRUNO, PLACE.lat, JAN_10 + DAY)]);
  ({ cells, published } = publish(cells, published, JAN_10 + 2 * DAY));
  assert.deepEqual(published, {});
  ({ published } = publish(cells, published, Date.UTC(2026, 1, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.n, 2);
});

test("a published one-install cell changes only in monthly batches", () => {
  let cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  ({ cells, published } = publish(cells, {}, Date.UTC(2026, 1, 10, 6)));
  ({ cells, published } = publish(cells, published, Date.UTC(2026, 2, 1, 6)));
  const march = published;
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 2, 5, 13))]);
  ({ cells, published } = publish(cells, published, Date.UTC(2026, 2, 6, 6)));
  assert.deepEqual(published, march);
  ({ published } = publish(cells, published, Date.UTC(2026, 3, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.n, 2);
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-03");
});

test("public cells are grouped by their region tile", () => {
  const cells: Record<string, CellState> = {};
  const far = PLACE.lat + 1;
  accumulate(cells, [ALICE, BRUNO].flatMap((id) => [sample(id, PLACE.lat, JAN_10), sample(id, far, JAN_10)]));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  const byTile = tiles(published);
  assert.deepEqual(byTile[cellToParent(h3At(PLACE.lat), TILE_RESOLUTION)]?.map((c) => c.h3), [h3At(PLACE.lat)]);
  assert.deepEqual(byTile[cellToParent(h3At(far), TILE_RESOLUTION)]?.map((c) => c.h3), [h3At(far)]);
});

test("a batch leaves out a lone install's samples from the batch's own month", () => {
  let cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  ({ cells, published } = publish(cells, {}, Date.UTC(2026, 2, 1, 6)));
  const march = published;
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 3, 1, 2))]);
  ({ cells, published } = publish(cells, published, Date.UTC(2026, 3, 1, 6)));
  assert.deepEqual(published, march);
  ({ published } = publish(cells, published, Date.UTC(2026, 4, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.n, 2);
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-04");
});

test("a lone first visit on the 1st waits for the next batch", () => {
  let cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 2, 1, 2))]);
  let published: Record<string, PublicCell>;
  ({ cells, published } = publish(cells, {}, Date.UTC(2026, 2, 1, 6)));
  assert.deepEqual(published, {});
  ({ published } = publish(cells, published, Date.UTC(2026, 3, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-03");
});
