import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cellToChildren, cellToLatLng, cellToParent, getResolution, greatCircleDistance, latLngToCell } from "h3-js";
import {
  type CellState, type PublicCell, type StoredSample,
  ANCHOR_FIXES, CELL_RESOLUTION, DEPARTURE_FIXES, PRIVATE_RESOLUTION, STAYS, TILE_RESOLUTION, TRIM_M, accumulate, distancesComputed, publish, tiles,
  trimLengths, trimSession,
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
  let held: string[] = [];
  let published: Record<string, PublicCell> = {};
  let lastBatch: string | null = null;
  return days.map((day) => {
    ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, day));
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
  for (const end of [...fixes.slice(0, 50), ...fixes.slice(-30)]) {
    assert.equal(cells[latLngToCell(end.fix.lat, PLACE.lon, PRIVATE_RESOLUTION)], undefined);
  }
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
  // The start's first fixes cut 800 m; its ten-minute stay, which takes in the walk's first 200 m, and
  // the walk on to 400 m don't move. DEPARTURE_FIXES at 2 m/s take the walk from 800 m to 1400 m;
  // the crag's ten-minute stay starts 200 m short of it.
  assert.deepEqual([DEPARTURE_FIXES, STAYS[1]], [60, { fixes: 120, radiusM: 200 }]);
  assert.equal(atCrag(1600), 0);
  assert.equal(atCrag(1700), 1440);
});

test("rests every ten minutes on the walk from an end don't chain its cut to the crag", () => {
  // A minute still, a walk north at 1.2 m/s (6 m a fix) resting 3 minutes after every 10 minutes of
  // walking, two hours at a crag [metres] away, the same walk back, a minute still. Still fixes
  // jitter about 4 m. Each trim keeps the whole crag from the distance listed with it to 5 km.
  const session = (metres: number) => {
    const leg: number[] = [];
    for (let m = 6, walked = 1; m < metres; m += 6, walked++) leg.push(...Array<number>(walked % 120 === 0 ? 37 : 1).fill(m));
    const ms = [...Array<number>(12).fill(0), ...leg, ...Array<number>(1440).fill(metres), ...leg.map((m) => metres - m), ...Array<number>(12).fill(0)];
    const samples = ms.map((m, i) => {
      const still = m === ms[i - 1] || m === ms[i + 1];
      return sample(ALICE, PLACE.lat + (m + (still ? 4 * Math.sin(i * 1.7) : 0)) / 111_195, JAN_10 + i * 5_000);
    });
    return { samples, crag: new Set(samples.filter((_, i) => ms[i] === metres)) };
  };
  const keptAtCrag = (metres: number, trimM: number) => {
    const { samples, crag } = session(metres);
    return trimSession(samples, trimM, trimM).filter((s) => crag.has(s)).length;
  };
  for (const [trimM, metres] of [[TRIM_M.min, 860], [550, 1320], [TRIM_M.max, 1940]] as const) {
    for (const crag of [metres, metres + 70, metres + 360, 5_000]) assert.equal(keptAtCrag(crag, trimM), 1440, `${trimM} ${crag}`);
  }
});

/** A tick every 5 s; the listed latitude i is a fix held for [held](i) ticks, three unless given. */
const repeatedFixes = (lats: number[], held: (i: number) => number = () => 3) =>
  lats.flatMap((lat, i) => Array<number>(held(i)).fill(lat)).map((lat, i) => sample(ALICE, lat, JAN_10 + i * 5_000));
/** [count] latitudes [metres] apart along a meridian, after [from]. */
const steps = (from: number, count: number, metres: number) => Array.from({ length: count }, (_, i) => from + ((i + 1) * metres) / 111_195);

test("wrong fixes repeated over three ticks don't bring an end's departure sooner", () => {
  const hour = (lat: number) => Array.from({ length: 240 }, (_, i) => lat + 0.00009 * Math.sin(i * 1.7));
  const end = PLACE.lat + 0.1;
  // Forty wrong fixes drift 200 m apart, 120 samples, then an hour still at home, a drive, and the same mirrored.
  const session = repeatedFixes([
    ...steps(PLACE.lat - 0.1, 40, 200), ...hour(PLACE.lat), ...steps(PLACE.lat, 499, 200), ...hour(end), ...steps(end + 0.1, 40, -200).toReversed(),
  ]);
  for (const trimM of [TRIM_M.min, TRIM_M.max]) assertClear(trimSession(session, trimM, trimM), [PLACE.lat, end], trimM, `${trimM}`);
});

test("an end's first fixes repeated over three ticks still cut ANCHOR_FIXES distinct fixes", () => {
  const end = PLACE.lat + 0.1;
  // Four wrong fixes glide to the phone at 200 m a fix, and it drives off at the same pace; the same mirrored.
  const session = repeatedFixes([...steps(PLACE.lat, 4, -200).toReversed(), PLACE.lat, ...steps(PLACE.lat, 499, 200), end, ...steps(end, 4, 200)]);
  for (const trimM of [TRIM_M.min, TRIM_M.max]) assertClear(trimSession(session, trimM, trimM), [PLACE.lat, end], trimM, `${trimM}`);
});

test("fixes held for different numbers of ticks don't change which wrong fixes stay", () => {
  // Ten clusters 250 m apart of 2 wrong fixes, 26 at 45 m on and 10 at 90 m on, all distinct. Held one
  // tick, a cluster's 50 m stay starts at its 26 and takes in its 10; held longer, it starts at its 2
  // and ends before its 10, which form no stay of their own.
  const cluster = [0, 1, ...Array.from({ length: 26 }, (_, i) => 45 + i / 100), ...Array.from({ length: 10 }, (_, i) => 90 + i / 100)];
  // The clusters from [from] towards [home], listed in that order.
  const clusters = (from: number, home: number) =>
    Array.from({ length: 10 }, (_, m) => cluster.map((x) => from + (Math.sign(home - from) * (m * 250 + x)) / 111_195)).flat();
  const home = (lat: number) => Array.from({ length: 120 }, (_, i) => lat + 0.00009 * Math.sin(i * 1.7));
  const end = PLACE.lat + 0.1;
  // One fix 5 km off, the clusters, home, a 10 km drive, and the same mirrored.
  const lats = [
    PLACE.lat - 0.045, ...clusters(PLACE.lat - 0.03, PLACE.lat), ...home(PLACE.lat), ...steps(PLACE.lat, 499, 200),
    ...home(end), ...clusters(end + 0.03, end).toReversed(), end + 0.045,
  ];
  const helds = { 1: () => 1, 2: () => 2, 3: () => 3, "1-3": (i: number) => [1, 3, 2, 3, 1, 2, 2, 1, 3][i % 9] ?? 1 };
  for (const [name, held] of Object.entries(helds)) {
    for (const trimM of [TRIM_M.min, (TRIM_M.min + TRIM_M.max) / 2, TRIM_M.max]) {
      assertClear(trimSession(repeatedFixes(lats, held), trimM, trimM), [PLACE.lat, end], trimM, `${name} ${trimM}`);
    }
  }
});

test("a step faster than any phone moves after an end's cut doesn't restart it", () => {
  const fixes = walk(401);
  // One fix 1 km off in the middle: two steps longer than either trim, both after the cuts.
  fixes[200] = { ...sample(ALICE, PLACE.lat + 200 * 0.00009, JAN_10 + 200 * 5_000), fix: { lat: PLACE.lat, lon: PLACE.lon + 0.01, mock: false } };
  assert.deepEqual(trimSession(fixes, 555, 345), fixes.slice(67, 355));
});

test("a 14 h session that never leaves its start costs a bounded number of distances per fix", () => {
  // A fix every 5 s within about 10 m of PLACE, every 50th 1.2 km off: it never departs, so every place cuts.
  // About 5 000 places' anchors each cut around them; testing each against every fix would take about 10 000 distances per fix.
  const session = Array.from({ length: 10_080 }, (_, i) =>
    sample(ALICE, i % 50 === 49 ? PLACE.lat - 0.011 : PLACE.lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + i * 5_000));
  for (const trimM of [TRIM_M.min, TRIM_M.max]) {
    const before = distancesComputed;
    assert.deepEqual(trimSession(session, trimM, trimM), []);
    assert.ok(distancesComputed - before < 100 * session.length, `${trimM}: ${distancesComputed - before}`);
  }
});

test("a session that flaps between two places costs a bounded number of distances per fix", () => {
  // 4 000 fixes alternating between PLACE and a point 1.2 km south: each jump starts a place, so the
  // start never departs and has about 48 000 anchors near two spots, at the same two coordinates or,
  // jittered, each up to 10 m off. Then a walk 1.7 km north and a rest there; at the longest trim
  // the cuts around the start and the rest meet.
  const rest = PLACE.lat + 1_700 / 111_195;
  for (const jitter of [0, 0.00009]) {
    const lats = [
      ...Array.from({ length: 4_000 }, (_, i) => (i % 2 === 0 ? PLACE.lat : PLACE.lat - 0.011) + jitter * Math.sin(i * 1.7)),
      ...Array.from({ length: 300 }, (_, i) => PLACE.lat + ((i + 1) * 1_700) / 300 / 111_195),
      ...Array.from({ length: 4_000 }, (_, i) => rest + 0.00009 * Math.sin(i * 1.7)),
    ];
    const session = lats.map((lat, i) => sample(ALICE, lat, JAN_10 + i * 5_000));
    for (const trimM of [TRIM_M.min, TRIM_M.max]) {
      const before = distancesComputed;
      const kept = trimSession(session, trimM, trimM);
      if (trimM === TRIM_M.min) assertClear(kept, [PLACE.lat, PLACE.lat - 0.011, rest], trimM - jitter * 111_195, `${jitter} ${trimM}`);
      else assert.deepEqual(kept, [], `${jitter} ${trimM}`);
      assert.ok(distancesComputed - before < 100 * session.length, `${jitter} ${trimM}: ${distancesComputed - before}`);
    }
  }
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
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, JAN_10 + DAY));
  accumulate(cells, [sample(BRUNO, PLACE.lat, JAN_10 + DAY)]);
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, JAN_10 + 2 * DAY));
  assert.deepEqual(published, {});
  ({ published } = publish(cells, held, published, lastBatch, Date.UTC(2026, 1, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
});

test("a published one-install cell changes only in monthly batches", () => {
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, Date.UTC(2026, 1, 10, 6)));
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, Date.UTC(2026, 2, 1, 6)));
  const march = published;
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 2, 5, 13))]);
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, Date.UTC(2026, 2, 6, 6)));
  assert.deepEqual(published, march);
  ({ published } = publish(cells, held, published, lastBatch, Date.UTC(2026, 3, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-03");
});

test("a batch missed on the 1st runs in the next publication with what the 1st would publish", () => {
  const cells: Record<string, CellState> = {};
  const early = PLACE.lat;
  const late = PLACE.lat + 0.01;
  // [early] is 30 days old by the end of 1 February; [late] only on 2 February at 02:00.
  accumulate(cells, [
    sample(ALICE, early, Date.UTC(2026, 0, 2, 13)),
    sample(ALICE, late, Date.UTC(2026, 0, 3, 2)),
    sample(ALICE, early, Date.UTC(2026, 1, 1, 9)),
  ]);
  const days = [Date.UTC(2026, 0, 31, 6), Date.UTC(2026, 1, 2, 6), Date.UTC(2026, 2, 1, 6)];
  const [janLast, febCatchUp = {}, marBatch = {}] = publishOn(cells, days);
  assert.deepEqual(janLast, {});
  assert.deepEqual(Object.keys(febCatchUp), [h3At(early)]);
  assert.equal(febCatchUp[h3At(early)]?.carriers["72406"]?.serviceN, 1);
  assert.equal(febCatchUp[h3At(early)]?.lastSeen, "2026-01");
  assert.deepEqual(Object.keys(marBatch).sort(), [h3At(early), h3At(late)].sort());
  assert.equal(marBatch[h3At(early)]?.lastSeen, "2026-02");
});

test("two publications in one month run the batch only once", () => {
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2025, 11, 20, 13))]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, Date.UTC(2026, 1, 2, 6)));
  assert.equal(lastBatch, "2026-02");
  const february = published;
  assert.deepEqual(Object.keys(february), [h3At(PLACE.lat)]);
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 0, 25, 13))]);
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, Date.UTC(2026, 1, 3, 6)));
  assert.deepEqual(published, february);
  assert.equal(lastBatch, "2026-02");
  ({ published } = publish(cells, held, published, lastBatch, Date.UTC(2026, 2, 4, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
});

test("the batch runs across a year boundary", () => {
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2025, 10, 25, 13))]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, Date.UTC(2025, 11, 1, 6)));
  assert.equal(lastBatch, "2025-12");
  assert.deepEqual(published, {});
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, Date.UTC(2026, 0, 1, 6)));
  assert.equal(lastBatch, "2026-01");
  assert.deepEqual(Object.keys(published), [h3At(PLACE.lat)]);
  assert.throws(() => publish(cells, held, published, "2026-01", Date.UTC(2025, 11, 15, 6)), /later than 2025-12/);
});

test("a publication without a previous batch but with public cells throws", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2025, 11, 20, 13))]);
  const february = publish(cells, [], {}, null, Date.UTC(2026, 1, 1, 6));
  assert.deepEqual(Object.keys(february.published), [h3At(PLACE.lat)]);
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 0, 25, 13))]);
  assert.throws(() => publish(cells, february.held, february.published, null, Date.UTC(2026, 1, 15, 6)), /no previous batch/);
});

test("a publication whose previous batch is in a later month throws", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  assert.throws(() => publish(cells, [], {}, "2026-03", Date.UTC(2026, 1, 1, 6)), /later than 2026-02/);
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
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, Date.UTC(2026, 2, 1, 6)));
  const march = published;
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 3, 1, 2))]);
  ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, Date.UTC(2026, 3, 1, 6)));
  assert.deepEqual(published, march);
  ({ published } = publish(cells, held, published, lastBatch, Date.UTC(2026, 4, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-04");
});

test("a lone first visit on the 1st waits for the next batch", () => {
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 2, 1, 2))]);
  let published: Record<string, PublicCell>;
  let lastBatch: string | null = null;
  ({ held, published, lastBatch } = publish(cells, held, {}, lastBatch, Date.UTC(2026, 2, 1, 6)));
  assert.deepEqual(published, {});
  ({ published } = publish(cells, held, published, lastBatch, Date.UTC(2026, 3, 1, 6)));
  assert.equal(published[h3At(PLACE.lat)]?.lastSeen, "2026-03");
});

/** Samples by [installId] at the centres of [cells], a minute apart from [timeMs]. */
const at = (installId: string, cells: string[], timeMs: number) =>
  cells.map((h3, i) => {
    const [lat = 0, lon = 0] = cellToLatLng(h3);
    return sample(installId, lat, timeMs + i * 60_000, { fix: { lat, lon, mock: false } });
  });

test("private cells are finer than public ones, and a public cell sums the private cells in it", () => {
  const parent = h3At(PLACE.lat);
  const [west = "", east = ""] = cellToChildren(parent, PRIVATE_RESOLUTION).slice(1, 3);
  const cells: Record<string, CellState> = {};
  accumulate(cells, [...at(ALICE, [west], JAN_10), ...at(BRUNO, [east], JAN_10)]);
  assert.deepEqual(Object.keys(cells).sort(), [west, east].sort());
  const [nextDay = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(Object.keys(nextDay), [parent]);
  assert.equal(nextDay[parent]?.carriers["72406"]?.serviceN, 2);
  const text = JSON.stringify(tiles(nextDay));
  for (const secret of [west, east]) assert.equal(text.includes(secret), false, secret);
});

test("an install in several private cells counts once in their public cell", () => {
  const parent = h3At(PLACE.lat);
  const cells: Record<string, CellState> = {};
  accumulate(cells, at(ALICE, cellToChildren(parent, PRIVATE_RESOLUTION), JAN_10));
  const { held, published, lastBatch } = publish(cells, [], {}, null, JAN_10 + DAY);
  assert.deepEqual([held, published], [[parent], {}]);
  const february = publish(cells, held, published, lastBatch, Date.UTC(2026, 1, 1, 6));
  assert.deepEqual([february.held, february.published], [[parent], {}]);
  const march = publish(cells, february.held, february.published, february.lastBatch, Date.UTC(2026, 2, 1, 6));
  assert.deepEqual(march.held, []);
  assert.equal(march.published[parent]?.carriers["72406"]?.serviceN, 7);
});

/** Numbers in [0, 1) from [seed] (mulberry32), so the made-up data is the same on every run. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Made-up visits by three installs to a patch about 180 m across from January to March 2026, six
 * samples each, at points whose resolution 12 cell's parent is their resolution 11 cell.
 */
function madeUpVisits(): StoredSample[][] {
  const random = seeded(180);
  const installs = ["0b9d2e44-8f3a-4c6b-b1d7-5e2a9c8f7d36", "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67", "5f2c8a1e-6b4d-4e9a-a3c7-2d8f0b1e6c95"];
  const states = ["IN_SERVICE", "IN_SERVICE", "IN_SERVICE", "EMERGENCY_ONLY", "OUT_OF_SERVICE"];
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)] as T;
  return Array.from({ length: 24 }, () => {
    const installId = pick(installs);
    const startMs = Date.UTC(2026, 0, 2, 13) + Math.floor(random() * 85) * 86_400_000;
    const samples: StoredSample[] = [];
    while (samples.length < 6) {
      const lat = -15.5 + (random() - 0.5) * 0.0016;
      const lon = -47.5 + (random() - 0.5) * 0.0016;
      if (cellToParent(latLngToCell(lat, lon, 12), CELL_RESOLUTION) !== latLngToCell(lat, lon, CELL_RESOLUTION)) continue;
      const timeMs = startMs + samples.length * 60_000;
      samples.push({
        installId, sessionId: "c3a7e915-2d4b-4f8a-9e6c-1b0d5a7f3e28", timeMs, elapsedRealtimeMs: timeMs - startMs,
        fix: { lat, lon, mock: false },
        sims: [
          { simPlmn: "72406", serviceState: pick(states), cells: [{ source: "CELL_INFO", rat: pick(["LTE", "NR"]), registered: true, rsrp: -120 + Math.floor(random() * 40) }] },
          { simPlmn: "72402", serviceState: pick(states), cells: null },
        ],
      });
    }
    return samples;
  });
}

test("public cells are those the same samples give when kept per public cell", () => {
  // aggregate.public.json lists, for each day from 3 January to 2 May 2026 whose publication
  // changed a public cell, that cell as published from the same visits with the private state kept
  // per resolution 11 cell. The visits avoid the points whose private cell has another parent.
  const expected = JSON.parse(readFileSync(new URL("../src/aggregate.public.json", import.meta.url), "utf8")) as [string, PublicCell][];
  const cells: Record<string, CellState> = {};
  let held: string[] = [];
  let published: Record<string, PublicCell> = {};
  let lastBatch: string | null = null;
  let pending = madeUpVisits();
  const changes: [string, PublicCell][] = [];
  for (let nowMs = Date.UTC(2026, 0, 3, 6); nowMs <= Date.UTC(2026, 4, 2, 6); nowMs += DAY) {
    accumulate(cells, pending.filter(([first]) => (first?.timeMs ?? 0) < nowMs).flat());
    pending = pending.filter(([first]) => (first?.timeMs ?? 0) >= nowMs);
    const before = published;
    ({ held, published, lastBatch } = publish(cells, held, published, lastBatch, nowMs));
    for (const [h3, cell] of Object.entries(published)) {
      assert.equal(getResolution(h3), CELL_RESOLUTION);
      if (JSON.stringify(cell) !== JSON.stringify(before[h3])) changes.push([new Date(nowMs).toISOString().slice(0, 10), cell]);
    }
  }
  assert.ok(Object.values(cells).length > Object.values(published).length);
  assert.deepEqual(changes, expected);
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

test("an out-of-service reading whose cells are unknown counts towards noServiceN and nothing else", () => {
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
    "72406": { best: null, median: null, tech: null, serviceN: 0, emergencyN: 0, noServiceN: 2 },
  });
});

test("an in-service reading whose cells are unknown counts towards serviceN and nothing else", () => {
  const cells: Record<string, CellState> = {};
  const unknown = { simPlmn: "72406", serviceState: "IN_SERVICE", cells: null };
  const known = { simPlmn: "72406", serviceState: "IN_SERVICE", cells: [{ source: "CELL_INFO", rat: "LTE", registered: true, rsrp: -100 }] };
  accumulate(cells, [ALICE, BRUNO, ALICE].map((id, i) => sample(id, PLACE.lat, JAN_10 + i * 60_000, { sims: [i === 1 ? known : unknown] })));
  const [published = {}] = publishOn(cells, [JAN_10 + DAY]);
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72406": { best: -100, median: -100, tech: "LTE", serviceN: 3, emergencyN: 0, noServiceN: 0 },
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
