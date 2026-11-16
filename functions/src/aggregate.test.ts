import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cellToChildren, cellToLatLng, cellToParent, getResolution, greatCircleDistance, latLngToCell } from "h3-js";
import {
  type CellState, type PublicCell, type StoredSample,
  ANCHOR_FIXES, CELL_RESOLUTION, DEPARTURE_FIXES, LONG_REST_MS, OVERVIEW_RESOLUTIONS, PRIVATE_RESOLUTION, REST_CUT_M, STAYS, TILE_RESOLUTION,
  accumulate, distancesComputed, label, overview, publish, tiles, trimSession,
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

/** A walk north from [PLACE] with a fix every 5 s, about 10 m apart. */
const walk = (length: number) =>
  Array.from({ length }, (_, i) => sample(ALICE, PLACE.lat + i * 0.00009, JAN_10 + i * 5_000));

/** [length] fixes 30 s apart from [from] 30 s steps on, still within about 10 m of [lat]. */
const still = (lat: number, from: number, length = 360) =>
  Array.from({ length }, (_, i) => sample(ALICE, lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + (from + i) * 30_000));

/** Asserts that [kept] is not empty and that none of it lies within [metres] of the latitudes [places]. */
function assertClear(kept: StoredSample[], places: number[], metres: number, message?: string) {
  assert.ok(kept.length > 0, message);
  for (const { fix } of kept) {
    for (const lat of places) assert.ok(greatCircleDistance([lat, PLACE.lon], [fix.lat, fix.lon], "m") > metres, message);
  }
}

test("a session that starts and ends while moving keeps its first and last samples", () => {
  // A walk, and a drive at 72 km/h (100 m every 5 s), each logged from the first fix to the last.
  const drive = Array.from({ length: 400 }, (_, i) => sample(ALICE, PLACE.lat + i * 0.0009, JAN_10 + i * 5_000));
  for (const session of [walk(401), drive]) assert.deepEqual(trimSession(session.toReversed()), session);
});

test("a phone left still at either end loses those samples despite GPS jitter", () => {
  // Three hours still at each end, a fix every 30 s within about 10 m, and a 3 km walk between.
  const end = PLACE.lat + 0.027;
  const between = Array.from({ length: 30 }, (_, i) => sample(ALICE, PLACE.lat + (i + 1) * 0.0009, JAN_10 + (360 + i) * 30_000));
  assertClear(trimSession([...still(PLACE.lat, 0), ...between, ...still(end, 390)]), [PLACE.lat, end], REST_CUT_M);
});

/** [minutes] still at PLACE, a fix every 5 s within about 10 m, then a walk north of 400 fixes 10 m apart. */
const restThenWalk = (minutes: number) => {
  const rest = Array.from({ length: minutes * 12 }, (_, i) => sample(ALICE, PLACE.lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + i * 5_000));
  const away = Array.from({ length: 400 }, (_, i) => sample(ALICE, PLACE.lat + (i + 1) * 0.00009, JAN_10 + (rest.length + i) * 5_000));
  return { rest, away };
};

test("a stop shorter than LONG_REST_MS at a session's start, such as at the car at a trailhead, keeps its samples", () => {
  assert.equal(LONG_REST_MS, 30 * 60_000);
  for (const minutes of [5, 25]) {
    const { rest, away } = restThenWalk(minutes);
    const session = [...rest, ...away];
    assert.deepEqual(trimSession(session), session, `${minutes} min`);
    // The same backwards in time: a walk to the stop, where the session ends.
    const ending = session.map((s) => ({ ...s, elapsedRealtimeMs: -s.elapsedRealtimeMs }));
    assert.deepEqual(trimSession(ending), ending.toReversed(), `${minutes} min at the end`);
  }
});

test("a rest whose stays a wrong fix keeps breaking still counts as one long rest", () => {
  // Forty-five minutes still, one fix in 150 lying 220 m off, so no stay lasts 13 minutes, then the walk.
  const { rest, away } = restThenWalk(45);
  const broken = rest.map((s, i) => (i % 150 === 149 ? { ...s, fix: { ...s.fix, lat: PLACE.lat + 220 / 111_195 } } : s));
  assertClear(trimSession([...broken, ...away]), [PLACE.lat], REST_CUT_M);
});

test("a session that starts after a long rest hides the fixes around the rest and keeps the walk past them", () => {
  const { rest, away } = restThenWalk(45);
  const kept = trimSession([...rest, ...away]);
  assertClear(kept, [PLACE.lat], REST_CUT_M);
  // The rest's indoor stay takes in the walk's first 200 m, so it cuts at most 300 + 200 + 100 m.
  const metres = (s: StoredSample) => greatCircleDistance([PLACE.lat, PLACE.lon], [s.fix.lat, s.fix.lon], "m");
  assert.deepEqual(kept, away.slice(away.length - kept.length));
  assert.ok(kept.includes(away.find((s) => metres(s) > REST_CUT_M + STAYS[1].radiusM * 1.5) as StoredSample));
});

test("trimming draws nothing at random and gives the same samples for the same session", () => {
  const session = [...still(PLACE.lat, 0), ...walk(300).map((s) => ({ ...s, elapsedRealtimeMs: s.elapsedRealtimeMs + 20_000_000 }))];
  const random = Math.random;
  Math.random = () => assert.fail("trimSession drew a random number");
  try {
    const kept = trimSession(session);
    assert.ok(kept.length > 0);
    assert.deepEqual(trimSession([...session].reverse()), kept);
  } finally {
    Math.random = random;
  }
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
  const off = (1.3 * REST_CUT_M) / 111_195;
  const cases = {
    // Twelve repeats of a network fix 1.3 cuts off, then an hour still with jitter, at each end.
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
    // Ten minutes 1 km off, a 100 s glide home in 50 m steps (36 km/h), half an hour still, at each end.
    glide: session([
      repeat(120, PLACE.lat - 0.009), glide(PLACE.lat - 0.009, PLACE.lat), hour(PLACE.lat).slice(0, 361), out,
      hour(end).slice(0, 361), glide(end + 0.009, end).toReversed(), repeat(120, end + 0.009),
    ]),
  };
  for (const [name, s] of Object.entries(cases)) assertClear(trimSession(s), [PLACE.lat, end], REST_CUT_M, name);
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
  assertClear(trimSession(session), [PLACE.lat, end], REST_CUT_M);
});

test("a stay is cut out unless the phone first moves away from the end for DEPARTURE_FIXES", () => {
  // Ten minutes still, a walk north at 2 m/s to a crag [metres] away, two hours there, the walk back, ten minutes still.
  const session = (metres: number) => {
    const walkOut = Array.from({ length: metres / 10 - 1 }, (_, i) => (i + 1) * 10);
    const ms = [...Array(120).fill(0), ...walkOut, ...Array(1440).fill(metres), ...walkOut.toReversed(), ...Array(120).fill(0)];
    return ms.map((m: number, i) => sample(ALICE, PLACE.lat + m / 111_195, JAN_10 + i * 5_000));
  };
  const atCrag = (metres: number) =>
    trimSession(session(metres)).filter((s) => s.fix.lat === PLACE.lat + metres / 111_195).length;
  // The start's ten-minute stay takes in the walk to 190 m, and the walk on to 380 m doesn't
  // move. DEPARTURE_FIXES at 2 m/s take the walk from 390 m to 980 m; the crag's ten-minute stay
  // starts at the first fix less than 200 m from it.
  assert.deepEqual([DEPARTURE_FIXES, STAYS[1]], [60, { fixes: 120, radiusM: 200 }]);
  assert.equal(atCrag(1170), 0);
  assert.equal(atCrag(1180), 1440);
});

test("rests every ten minutes on the walk from an end don't chain its cut to the crag", () => {
  // A minute still, a walk north at 1.2 m/s (6 m a fix) resting 3 minutes after every 10 minutes of
  // walking, two hours at a crag [metres] away, the same walk back, a minute still. Still fixes
  // jitter about 4 m. The whole crag is kept from 490 m to 5 km.
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
  const keptAtCrag = (metres: number) => {
    const { samples, crag } = session(metres);
    return trimSession(samples).filter((s) => crag.has(s)).length;
  };
  for (const crag of [490, 560, 850, 5_000]) assert.equal(keptAtCrag(crag), 1440, `${crag}`);
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
  assertClear(trimSession(session), [PLACE.lat, end], REST_CUT_M);
});

test("fixes repeated over three ticks after a step from a wrong fix still cut ANCHOR_FIXES distinct fixes", () => {
  const end = PLACE.lat + 0.1;
  // One fix 5 km off, four wrong fixes glide to the phone at 200 m a fix, and it drives off at the same pace; the same mirrored.
  const session = repeatedFixes([
    PLACE.lat - 0.045, ...steps(PLACE.lat, 4, -200).toReversed(), PLACE.lat, ...steps(PLACE.lat, 499, 200), end, ...steps(end, 4, 200), end + 0.045,
  ]);
  assertClear(trimSession(session), [PLACE.lat, end], REST_CUT_M);
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
  for (const [name, held] of Object.entries(helds)) assertClear(trimSession(repeatedFixes(lats, held)), [PLACE.lat, end], REST_CUT_M, name);
});

test("a step faster than any phone moves, once the phone has left an end, cuts nothing", () => {
  const fixes = walk(401);
  // One fix 1 km off in the middle: two steps longer than the cut, long after the phone left either end.
  fixes[200] = { ...sample(ALICE, PLACE.lat + 200 * 0.00009, JAN_10 + 200 * 5_000), fix: { lat: PLACE.lat, lon: PLACE.lon + 0.01, mock: false } };
  assert.deepEqual(trimSession(fixes), fixes);
});

test("a 14 h session that never leaves its start costs a bounded number of distances per fix", () => {
  // A fix every 5 s within about 10 m of PLACE, every 50th 1.2 km off: it never departs, so every place cuts.
  // About 5 000 places' anchors each cut around them; testing each against every fix would take about 10 000 distances per fix.
  const session = Array.from({ length: 10_080 }, (_, i) =>
    sample(ALICE, i % 50 === 49 ? PLACE.lat - 0.011 : PLACE.lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + i * 5_000));
  const before = distancesComputed;
  assert.deepEqual(trimSession(session), []);
  assert.ok(distancesComputed - before < 100 * session.length, `${distancesComputed - before}`);
});

test("a 14 h session whose short stays keep breaking costs a bounded number of distances per fix", () => {
  // A fix every 5 s within 2 m of PLACE, every 40th 52.5 m off: each off fix ends a stay of the
  // first kind, and the fixes after it lie within that stay's spread plus its radius.
  const session = Array.from({ length: 10_080 }, (_, i) =>
    sample(ALICE, PLACE.lat + (i % 40 === 39 ? 52.5 : 2 * Math.sin(i * 1.7)) / 111_195, JAN_10 + i * 5_000));
  const before = distancesComputed;
  assert.deepEqual(trimSession(session), []);
  assert.ok(distancesComputed - before < 100 * session.length, `${distancesComputed - before}`);
});

test("a session that flaps between two places costs a bounded number of distances per fix", () => {
  // 4 000 fixes alternating between PLACE and a point 1.2 km south: each jump starts a place, so the
  // start never departs and has about 48 000 anchors near two spots, at the same two coordinates or,
  // jittered, each up to 10 m off. Then a walk 1.7 km north and a rest there.
  const rest = PLACE.lat + 1_700 / 111_195;
  for (const jitter of [0, 0.00009]) {
    const lats = [
      ...Array.from({ length: 4_000 }, (_, i) => (i % 2 === 0 ? PLACE.lat : PLACE.lat - 0.011) + jitter * Math.sin(i * 1.7)),
      ...Array.from({ length: 300 }, (_, i) => PLACE.lat + ((i + 1) * 1_700) / 300 / 111_195),
      ...Array.from({ length: 4_000 }, (_, i) => rest + 0.00009 * Math.sin(i * 1.7)),
    ];
    const session = lats.map((lat, i) => sample(ALICE, lat, JAN_10 + i * 5_000));
    const before = distancesComputed;
    const kept = trimSession(session);
    assertClear(kept, [PLACE.lat, PLACE.lat - 0.011, rest], REST_CUT_M - jitter * 111_195, `${jitter}`);
    assert.ok(distancesComputed - before < 100 * session.length, `${jitter}: ${distancesComputed - before}`);
  }
});

test("mock fixes are dropped and count for nothing", () => {
  const fixes = walk(211);
  const mocked = { ...fixes[105], fix: { lat: PLACE.lat + 0.009, lon: PLACE.lon, mock: true } } as StoredSample;
  fixes[105] = mocked;
  assert.deepEqual(trimSession(fixes), [...fixes.slice(0, 105), ...fixes.slice(106)]);
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
  const nextDay = publish(Object.entries(cells));
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

test("a one-install cell is public the next day, and its later visits the day after each", () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(ALICE, PLACE.lat, JAN_10)]);
  const nextDay = publish(Object.entries(cells));
  assert.deepEqual(Object.keys(nextDay), [h3At(PLACE.lat)]);
  assert.equal(nextDay[h3At(PLACE.lat)]?.lastSeen, "2026-01");
  accumulate(cells, [sample(ALICE, PLACE.lat, Date.UTC(2026, 2, 5, 13))]);
  const march = publish(Object.entries(cells));
  assert.equal(march[h3At(PLACE.lat)]?.carriers["72406"]?.serviceN, 2);
  assert.equal(march[h3At(PLACE.lat)]?.lastSeen, "2026-03");
});

test("public cells are grouped by their region tile", () => {
  const cells: Record<string, CellState> = {};
  const far = PLACE.lat + 1;
  accumulate(cells, [ALICE, BRUNO].flatMap((id) => [sample(id, PLACE.lat, JAN_10), sample(id, far, JAN_10)]));
  const published = publish(Object.entries(cells));
  const byTile = tiles(published);
  assert.deepEqual(byTile[cellToParent(h3At(PLACE.lat), TILE_RESOLUTION)]?.map((c) => c.h3), [h3At(PLACE.lat)]);
  assert.deepEqual(byTile[cellToParent(h3At(far), TILE_RESOLUTION)]?.map((c) => c.h3), [h3At(far)]);
});

/** A public cell at [h3] seen in [lastSeen] with the counts (signal, emergency only, no service) of each carrier. */
function publicCell(h3: string, lastSeen: string, carriers: Record<string, [number, number, number]>): PublicCell {
  return {
    h3,
    lastSeen,
    carriers: Object.fromEntries(
      Object.entries(carriers).map(([plmn, [serviceN, emergencyN, noServiceN]]) => [plmn, { best: null, median: null, tech: null, serviceN, emergencyN, noServiceN }]),
    ),
  };
}

test("an overview cell counts, per carrier, the labels of the public cells inside it, and keeps their latest month", () => {
  const coarse = latLngToCell(PLACE.lat, PLACE.lon, 6);
  const [a = "", b = "", c = ""] = cellToChildren(coarse, CELL_RESOLUTION);
  const far = h3At(PLACE.lat + 1);
  const published = Object.fromEntries(
    [
      publicCell(a, "2026-02", { "72406": [199, 0, 1], "72402": [0, 0, 5] }),
      publicCell(b, "2026-05", { "72406": [1, 200, 0] }),
      publicCell(c, "2026-03", { "72406": [34, 33, 33] }),
      publicCell(far, "2026-01", { "72405": [10, 0, 0] }),
    ].map((cell) => [cell.h3, cell]),
  );
  assert.deepEqual(overview(published, 6), [
    { h3: coarse, carriers: { "72406": [1, 1, 1], "72402": [0, 0, 1] }, lastSeen: "2026-05" },
    { h3: cellToParent(far, 6), carriers: { "72405": [1, 0, 0] }, lastSeen: "2026-01" },
  ]);
  for (const resolution of OVERVIEW_RESOLUTIONS) {
    const cells = overview(published, resolution);
    assert.deepEqual(cells.map((cell) => cell.h3).sort(), [...new Set(Object.keys(published).map((h3) => cellToParent(h3, resolution)))].sort());
    assert.ok(cells.every((cell) => getResolution(cell.h3) === resolution));
  }
});

test("the overview labels a carrier in a public cell as the map page does", async () => {
  const page = (await import(new URL("../../map/public/label.js", import.meta.url).href)) as { label: typeof label };
  for (let serviceN = 0; serviceN <= 20; serviceN++) {
    for (let emergencyN = 0; emergencyN <= 20; emergencyN++) {
      for (const noServiceN of [0, 1, 2, 3, 10, 200]) {
        const figures = { best: null, median: null, tech: null, serviceN, emergencyN, noServiceN };
        assert.equal(label(figures), page.label(figures), JSON.stringify(figures));
      }
    }
  }
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
  const nextDay = publish(Object.entries(cells));
  assert.deepEqual(Object.keys(nextDay), [parent]);
  assert.equal(nextDay[parent]?.carriers["72406"]?.serviceN, 2);
  const text = JSON.stringify(tiles(nextDay));
  for (const secret of [west, east]) assert.equal(text.includes(secret), false, secret);
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
  // After an intended change to publish or accumulate, rewrite the file from this test's changes,
  // one entry per line: "[\n" + changes.map((c) => JSON.stringify(c)).join(",\n") + "\n]\n",
  // and review its diff as the change in the public cells.
  const expected = JSON.parse(readFileSync(new URL("../src/aggregate.public.json", import.meta.url), "utf8")) as [string, PublicCell][];
  const cells: Record<string, CellState> = {};
  let published: Record<string, PublicCell> = {};
  let pending = madeUpVisits();
  const changes: [string, PublicCell][] = [];
  for (let nowMs = Date.UTC(2026, 0, 3, 6); nowMs <= Date.UTC(2026, 4, 2, 6); nowMs += DAY) {
    accumulate(cells, pending.filter(([first]) => (first?.timeMs ?? 0) < nowMs).flat());
    pending = pending.filter(([first]) => (first?.timeMs ?? 0) >= nowMs);
    const before = published;
    published = publish(Object.entries(cells));
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
  const published = publish(Object.entries(withOff));
  const expected = publish(Object.entries(without));
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
  const published = publish(Object.entries(cells));
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
  const published = publish(Object.entries(cells));
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72406": { best: -100, median: -100, tech: "LTE", serviceN: 3, emergencyN: 0, noServiceN: 0 },
  });
});

test("a carrier seen only in emergency-only service with its cells unknown publishes its emergency count", () => {
  const cells: Record<string, CellState> = {};
  const emergency = { simPlmn: "72402", serviceState: "EMERGENCY_ONLY", cells: null };
  accumulate(cells, [ALICE, BRUNO, BRUNO].map((id, i) => sample(id, PLACE.lat, JAN_10 + i * 60_000, { sims: [emergency] })));
  const published = publish(Object.entries(cells));
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
  const published = publish(Object.entries(cells));
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
  const published = publish(Object.entries(cells));
  assert.deepEqual(published[h3At(PLACE.lat)]?.carriers, {
    "72406": { best: -120, median: -120, tech: "LTE", serviceN: 1, emergencyN: 200, noServiceN: 0 },
    "72402": { best: null, median: null, tech: null, serviceN: 0, emergencyN: 198, noServiceN: 3 },
  });
});
