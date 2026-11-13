import assert from "node:assert/strict";
import { test } from "node:test";
import { cellToParent, greatCircleDistance, latLngToCell } from "h3-js";
import {
  type CellState, type PublicCell, type StoredSample,
  ANCHOR_FIXES, CELL_RESOLUTION, DEPARTURE_FIXES, STAYS, TILE_RESOLUTION, TRIM_M, accumulate, publish, tiles, trimLengths, trimSession as nearLinearTrim,
} from "./aggregate.js";
import { referenceTrimSession } from "./trim-reference.js";

/** Every trim in these tests runs both implementations and asserts they keep the same samples. */
function trimSession(session: StoredSample[], startM: number, endM: number): StoredSample[] {
  const kept = nearLinearTrim(session, startM, endM);
  assert.deepEqual(kept, referenceTrimSession(session, startM, endM));
  return kept;
}

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

test("a home whose fixes jitter 50 to 100 m, reached by a glide, is cut out at either end", () => {
  // 0.001 degrees of longitude here is about 107 m. Fix i lies 50 to 100 m from [lat] in direction i * 2.4 rad.
  const lonM = 111_195 * Math.cos((PLACE.lat * Math.PI) / 180);
  const jitter = (lat: number, length: number) =>
    Array.from({ length }, (_, i) => {
      const metres = 50 + 50 * Math.abs(Math.sin(i * 1.3));
      return [lat + (metres * Math.cos(i * 2.4)) / 111_195, PLACE.lon + (metres * Math.sin(i * 2.4)) / lonM];
    });
  const line = (lats: number[]) => lats.map((lat) => [lat, PLACE.lon]);
  const end = PLACE.lat + 0.027;
  const glide = (from: number, to: number) => Array.from({ length: 19 }, (_, i) => from + ((i + 1) * (to - from)) / 20);
  // Ten minutes 1 km off, the glide home in 50 m steps, three hours at home, a 3 km walk, and the same mirrored.
  const points = [
    ...line(Array(120).fill(PLACE.lat - 0.009)), ...line(glide(PLACE.lat - 0.009, PLACE.lat)), ...jitter(PLACE.lat, 2160),
    ...line(Array.from({ length: 300 }, (_, i) => PLACE.lat + (i + 1) * 0.00009)),
    ...jitter(end, 2160), ...line(glide(end + 0.009, end).toReversed()), ...line(Array(120).fill(end + 0.009)),
  ];
  const session = points.map(([lat = 0, lon = 0], i) => ({ ...sample(ALICE, lat, JAN_10 + i * 5_000), fix: { lat, lon, mock: false } }));
  for (const trimM of [TRIM_M.min, TRIM_M.max]) assertClear(trimSession(session, trimM, trimM), [PLACE.lat, end], trimM, `${trimM}`);
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
  // 600 m further; the crag's ten-minute stay starts 200 m short of it.
  assert.deepEqual([DEPARTURE_FIXES, STAYS[1]], [60, { fixes: 120, radiusM: 200 }]);
  assert.equal(atCrag(1500), 0);
  assert.equal(atCrag(1700), 1440);
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
        "72406": { best: -90, median: -98, tech: "LTE", serviceN: 3, emergencyN: 0, noServiceN: 0 },
        "72402": { best: null, median: null, tech: null, serviceN: 0, emergencyN: 2, noServiceN: 0 },
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
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
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
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
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
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
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

test("a reading with the radio off or the service state unknown says nothing about coverage", () => {
  const radioOff = { simPlmn: "72406", serviceState: "POWER_OFF", cells: [] };
  const unknown = { simPlmn: "72402", serviceState: null, cells: [] };
  const off = (installId: string, timeMs: number) => sample(installId, PLACE.lat, timeMs, { sims: [radioOff, unknown] });
  const north = PLACE.lat + 0.01;

  // A cell whose only samples were taken with the radio off or service unknown is not published.
  const offOnly: Record<string, CellState> = {};
  accumulate(offOnly, [off(ALICE, JAN_10), off(BRUNO, JAN_10 + 60_000)]);
  assert.deepEqual(offOnly, {});

  // Next to in-service readings they change none of the cell's figures, and the other SIM still counts.
  const withOff: Record<string, CellState> = {};
  const without: Record<string, CellState> = {};
  const inService = [sample(ALICE, north, JAN_10), sample(BRUNO, north, JAN_10 + 60_000)];
  accumulate(without, inService);
  accumulate(withOff, [
    ...inService,
    sample(ALICE, north, JAN_10 + 120_000, { sims: [radioOff, { simPlmn: "72402", serviceState: "OUT_OF_SERVICE", cells: [] }] }),
    sample(BRUNO, north, JAN_10 + 180_000, { sims: [unknown] }),
  ]);
  const [published = {}] = publishOn(withOff, [JAN_10 + DAY]);
  const [expected = {}] = publishOn(without, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(north)]?.carriers["72406"], expected[h3At(north)]?.carriers["72406"]);
  assert.deepEqual(published[h3At(north)]?.carriers["72402"], { best: null, median: null, tech: null, serviceN: 0, emergencyN: 2, noServiceN: 1 });
});

test("a reading whose cells are unknown is not counted as no signal", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [ALICE, BRUNO].map((id, i) =>
    sample(id, PLACE.lat, JAN_10 + i * 60_000, {
      sims: [
        { simPlmn: "72406", serviceState: "OUT_OF_SERVICE", cells: null },
        { simPlmn: "72402", serviceState: "IN_SERVICE", cells: [{ source: "CELL_INFO", rat: "GSM", registered: true, rssi: -85 }] },
      ],
    })));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72402": { best: -85, median: -85, tech: "GSM", serviceN: 2, emergencyN: 0, noServiceN: 0 },
  });
});

test("a carrier seen only in emergency-only service with its cells unknown publishes its emergency count", () => {
  const cells: Record<string, CellState> = {};
  const emergency = { simPlmn: "72402", serviceState: "EMERGENCY_ONLY", cells: null };
  accumulate(cells, [ALICE, BRUNO, BRUNO].map((id, i) => sample(id, PLACE.lat, JAN_10 + i * 60_000, { sims: [emergency] })));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72402": { best: null, median: null, tech: null, serviceN: 0, emergencyN: 3, noServiceN: 0 },
  });
});

test("one emergency-only reading among in-service ones is counted once", () => {
  const cells: Record<string, CellState> = {};
  const inService = { simPlmn: "72406", serviceState: "IN_SERVICE", cells: [{ source: "CELL_INFO", rat: "LTE", registered: true, rsrp: -100 }] };
  const emergency = { simPlmn: "72406", serviceState: "EMERGENCY_ONLY", cells: [{ source: "CELL_INFO", rat: "LTE", registered: false, rsrp: -120 }] };
  accumulate(cells, [ALICE, BRUNO, ALICE, BRUNO, ALICE].map((id, i) =>
    sample(id, PLACE.lat, JAN_10 + i * 60_000, { sims: [i === 2 ? emergency : inService] })));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72406": { best: -100, median: -100, tech: "LTE", serviceN: 4, emergencyN: 1, noServiceN: 0 },
  });
});

test("only in-service readings give a strength and a network type, and each state is counted once", () => {
  const cells: Record<string, CellState> = {};
  const registered = (rsrp: number) => [{ source: "CELL_INFO", rat: "LTE", registered: true, rsrp }];
  const inService = { simPlmn: "72406", serviceState: "IN_SERVICE", cells: registered(-120) };
  const emergency = { simPlmn: "72406", serviceState: "EMERGENCY_ONLY", cells: registered(-80) };
  const outOfService = { simPlmn: "72402", serviceState: "OUT_OF_SERVICE", cells: [{ source: "CELL_INFO", rat: "GSM", registered: true, rssi: -70 }] };
  const camped = { simPlmn: "72402", serviceState: "EMERGENCY_ONLY", cells: registered(-90) };
  accumulate(cells, Array.from({ length: 201 }, (_, i) =>
    sample(i % 2 ? ALICE : BRUNO, PLACE.lat, JAN_10 + i * 60_000, { sims: [i === 0 ? inService : emergency, i < 3 ? outOfService : camped] })));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72406": { best: -120, median: -120, tech: "LTE", serviceN: 1, emergencyN: 200, noServiceN: 0 },
    "72402": { best: null, median: null, tech: null, serviceN: 0, emergencyN: 198, noServiceN: 3 },
  });
});

test("randomised sessions keep exactly the samples the reference trim keeps", () => {
  // A seeded generator (mulberry32), so a failure can be replayed.
  let seed = Number(process.env.TRIM_SEED ?? 124);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
  const count = (most: number) => Math.floor(random() * most);
  const stats = { sessions: 0, fixes: 0, empty: 0, whole: 0, partial: 0 };
  for (let n = 0; n < Number(process.env.TRIM_SESSIONS ?? 40); n++) {
    // Mostly in Brazil, sometimes anywhere, near the poles and the antimeridian included.
    const [baseLat, baseLon] = random() < 0.8 ? [-34 + random() * 39, -74 + random() * 40] : [-89 + random() * 178, -180 + random() * 360];
    const lonM = 111_195 * Math.cos((baseLat * Math.PI) / 180);
    // Positions in metres north and east of PLACE; [at] is where the phone really is.
    let at: [number, number] = [0, 0];
    let ms = 0;
    const points: [number, number, number, boolean][] = [];
    const add = ([north, east]: [number, number], step = pick([1_000, 5_000, 5_000, 5_000, 30_000])) => {
      ms += random() < 0.005 ? pick([60_000, 600_000, 1_200_000]) : step;
      points.push([north, east, ms, random() < 0.003]);
    };
    const off = (metres: number, angle = random() * 2 * Math.PI): [number, number] => [at[0] + metres * Math.cos(angle), at[1] + metres * Math.sin(angle)];
    // Wrong fixes around an end: repeated, scattered, a glide in to [at] or out of it, one stray, or none.
    const wrong = (inwards: boolean) => {
      const metres = 300 + random() * 2_000;
      const angle = random() * 2 * Math.PI;
      const length = count(150);
      const kind = pick(["repeat", "scatter", "glide", "single", "none"]);
      if (kind === "repeat") for (let i = 0; i < length; i++) add(off(metres, angle));
      if (kind === "scatter") for (let i = 0; i < length; i++) add(off(metres * (0.5 + random())));
      if (kind === "single") add(off(metres, angle));
      if (kind === "glide") {
        const steps = 5 + count(40);
        for (let i = 0; i < steps; i++) add(off((metres * (inwards ? steps - i : i + 1)) / steps, angle));
      }
    };
    // The phone at rest: within 10 m under open sky, or 50 to 100 m indoors.
    const rest = (length: number) => {
      const [min, max] = pick<[number, number]>([[0, 10], [50, 100], [0, 200]]);
      for (let i = 0; i < length; i++) add(off(min + random() * (max - min)), pick([5_000, 5_000, 30_000]));
    };
    const travel = (length: number) => {
      const speed = pick([0.3 + random() * 1.5, 5 + random() * 30]);
      const angle = random() * 2 * Math.PI;
      for (let i = 0; i < length; i++) {
        at = off(5 * speed, angle);
        add(random() < 0.01 ? off(1_000 + random() * 3_000) : at, 5_000);
        if (random() < 0.002) for (let j = 0; j < 12; j++) add(j % 2 ? off(1_500) : at, 5_000);
      }
    };
    wrong(true);
    rest(count(400));
    for (let leg = 1 + count(3); leg > 0; leg--) {
      travel(20 + count(300));
      if (random() < 0.6) rest(count(300));
    }
    rest(count(400));
    wrong(false);
    const session = points.map(([north, east, time, mock]) => ({
      ...sample(ALICE, baseLat + north / 111_195, JAN_10 + time),
      fix: { lat: baseLat + north / 111_195, lon: baseLon + east / lonM, mock },
    }));
    const draw = () => TRIM_M.min + random() * (TRIM_M.max - TRIM_M.min);
    const kept = trimSession(random() < 0.3 ? session.toReversed() : session, draw(), draw());
    stats.sessions++;
    stats.fixes += session.length;
    if (kept.length === 0) stats.empty++;
    else if (kept.length === session.filter((s) => !s.fix.mock).length) stats.whole++;
    else stats.partial++;
  }
  console.log(JSON.stringify(stats));
});
