import assert from "node:assert/strict";
import { test } from "node:test";
import { cellToParent, greatCircleDistance, latLngToCell } from "h3-js";
import {
  type CellState, type PublicCell, type StoredSample,
  CELL_RESOLUTION, TILE_RESOLUTION, TRIM_M, accumulate, publish, tiles, trimLengths, trimSession,
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

test("a session loses the samples within its trim lengths of either end", () => {
  const walk = Array.from({ length: 41 }, (_, i) => sample(ALICE, PLACE.lat + i * 0.0009, JAN_10 + i * 60_000));
  const kept = trimSession(walk.toReversed(), 550, 350);
  assert.deepEqual(kept, walk.slice(6, 37));

  const cells: Record<string, CellState> = {};
  accumulate(cells, kept);
  for (const end of [...walk.slice(0, 5), ...walk.slice(-3)]) assert.equal(cells[h3At(end.fix.lat)], undefined);
});

test("a phone left still at either end loses those samples despite GPS jitter", () => {
  // Three hours still at each end, a fix every 30 s within about 10 m, and a 3 km walk between.
  const still = (lat: number, from: number) =>
    Array.from({ length: 360 }, (_, i) => sample(ALICE, lat + 0.00009 * Math.sin(i * 1.7), JAN_10 + (from + i) * 30_000));
  const end = PLACE.lat + 0.027;
  const walk = Array.from({ length: 30 }, (_, i) => sample(ALICE, PLACE.lat + (i + 1) * 0.0009, JAN_10 + (360 + i) * 30_000));
  const session = [...still(PLACE.lat, 0), ...walk, ...still(end, 390)];
  const kept = trimSession(session, TRIM_M.max, TRIM_M.max);
  assert.ok(kept.length > 0);
  for (const { fix } of kept) {
    for (const lat of [PLACE.lat, end]) assert.ok(greatCircleDistance([lat, PLACE.lon], [fix.lat, fix.lon], "m") > TRIM_M.max);
  }
});

test("mock fixes are dropped and a session shorter than both trims keeps nothing", () => {
  const walk = Array.from({ length: 21 }, (_, i) => sample(ALICE, PLACE.lat + i * 0.0009, JAN_10 + i * 60_000));
  const mocked = { ...walk[10], fix: { lat: PLACE.lat + 0.009, lon: PLACE.lon, mock: true } } as StoredSample;
  walk[10] = mocked;
  const kept = trimSession(walk, 350, 350);
  assert.equal(kept.includes(mocked), false);
  assert.equal(kept.length, 12);
  assert.deepEqual(trimSession(walk, 1100, 1100), []);
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
