import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { cellToParent, latLngToCell } from "h3-js";
import { type CellState, type PublicCell, type StoredSample, CELL_RESOLUTION, TILE_RESOLUTION, accumulate, publish } from "./aggregate.js";
import { type DailyState, type PublishStore, runDaily } from "./daily.js";
import { INSTALL_ID, testSample } from "./test-sample.js";

// A made-up second install and place.
const OTHER = "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67";
const PLACE = { lat: -15.5, lon: -47.5 };
const JAN_10 = Date.UTC(2026, 0, 10, 13);
const DAY = 86_400_000;

const h3 = latLngToCell(PLACE.lat, PLACE.lon, CELL_RESOLUTION);

function sample(installId: string, timeMs: number): StoredSample {
  const s = testSample() as unknown as StoredSample;
  return { ...s, installId, timeMs, fix: { ...s.fix, ...PLACE } };
}

/**
 * A [PublishStore] in memory that records each commit's state and public cells, and each tile file
 * as the text that would be stored.
 */
function fakeStore(cells: Record<string, CellState>) {
  let state: DailyState = { held: [], lastBatch: null, runMs: null };
  const published: Record<string, PublicCell> = {};
  const commits: { next: DailyState; changed: Record<string, PublicCell> }[] = [];
  const files = new Map<string, string>();
  const store: PublishStore = {
    writeTile: async (tile, tileCells) => {
      files.set(tile, JSON.stringify(tileCells));
    },
    privateCells: async () => structuredClone(cells),
    state: async () => structuredClone(state),
    publicCells: async () => structuredClone(published),
    commit: async (expected, next, changed) => {
      if (!isDeepStrictEqual(state, expected)) return false;
      commits.push(structuredClone({ next, changed }));
      Object.assign(published, structuredClone(changed));
      state = structuredClone(next);
      return true;
    },
  };
  return { store, published, commits, files, state: () => state };
}

/** Private cells that publish one public cell, seen by two installs, on the first run. */
function sharedCells(): Record<string, CellState> {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)]);
  return cells;
}

test("each run writes every tile of all the public cells, holding only the fields of PublicCell", async () => {
  const fake = fakeStore(sharedCells());
  await runDaily(fake.store, JAN_10 + DAY);
  const tile = cellToParent(h3, TILE_RESOLUTION);
  assert.deepEqual([...fake.files.keys()], [tile]);
  const cells = JSON.parse(fake.files.get(tile) ?? "") as Record<string, unknown>[];
  assert.equal(cells.length, 1);
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), ["carriers", "h3", "lastSeen"]);
    assert.equal(cell.h3, h3);
    assert.match(cell.lastSeen as string, /^\d{4}-\d{2}$/);
    const carriers = Object.entries(cell.carriers as Record<string, Record<string, unknown>>);
    assert.ok(carriers.length > 0);
    for (const [plmn, carrier] of carriers) {
      assert.match(plmn, /^\d{5,6}$/);
      assert.deepEqual(Object.keys(carrier).sort(), ["best", "emergencyN", "median", "noServiceN", "serviceN", "tech"]);
    }
  }
  for (const id of [INSTALL_ID, OTHER, testSample().sessionId as string]) assert.ok(!fake.files.get(tile)?.includes(id));

  // A run that changes no public cell writes the same tiles again.
  fake.files.clear();
  await runDaily(fake.store, JAN_10 + 2 * DAY);
  assert.deepEqual([...fake.files], [[tile, JSON.stringify([fake.published[h3]])]]);
});

test("a failed tile write doesn't stop the others, and the run then throws", async () => {
  const cells = sharedCells();
  const far = { ...sample(INSTALL_ID, JAN_10), fix: { ...sample(INSTALL_ID, JAN_10).fix, lat: -20.5, lon: -42.5 } };
  accumulate(cells, [far, { ...far, installId: OTHER }]);
  const fake = fakeStore(cells);
  const failing = cellToParent(h3, TILE_RESOLUTION);
  const flaky: PublishStore = {
    ...fake.store,
    writeTile: (tile, tileCells) => (tile === failing ? Promise.reject(new Error("unavailable")) : fake.store.writeTile(tile, tileCells)),
  };
  await assert.rejects(runDaily(flaky, JAN_10 + DAY), /1 of 2 tile writes failed/);
  assert.equal(fake.commits.length, 1);
  assert.equal(fake.files.size, 1);
  assert.ok(!fake.files.has(failing));
});

test("each run writes held, lastBatch and the public cells that changed in one commit", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10)]);
  const fake = fakeStore(cells);

  await runDaily(fake.store, JAN_10 + DAY);
  assert.deepEqual(fake.commits, [{ next: { held: [h3], lastBatch: "2026-01", runMs: JAN_10 + DAY }, changed: {} }]);

  accumulate(cells, [sample(OTHER, JAN_10 + DAY)]);
  await runDaily(fake.store, Date.UTC(2026, 1, 1, 0, 30));
  const expected = publish(cells, [h3], {}, "2026-01", Date.UTC(2026, 1, 1, 0, 30));
  assert.deepEqual(fake.commits[1], {
    next: { held: expected.held, lastBatch: "2026-02", runMs: Date.UTC(2026, 1, 1, 0, 30) },
    changed: expected.published,
  });
  assert.deepEqual(Object.keys(fake.published), [h3]);
  assert.deepEqual(fake.state().held, []);
});

test("a run that changes no public cell writes only the state", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)]);
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  assert.deepEqual(Object.keys(fake.commits[0]?.changed ?? {}), [h3]);
  await runDaily(fake.store, JAN_10 + 2 * DAY);
  assert.deepEqual(fake.commits[1], { next: { held: [], lastBatch: "2026-01", runMs: JAN_10 + 2 * DAY }, changed: {} });
});

test("a run writes nothing when another run stored its state first", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)]);
  const fake = fakeStore(cells);
  const before = fake.state();
  const stale: PublishStore = { ...fake.store, state: async () => structuredClone(before) };
  await runDaily(fake.store, JAN_10 + DAY);
  await assert.rejects(runDaily(stale, JAN_10 + DAY));
  assert.equal(fake.commits.length, 1);
});

test("a run writes nothing when publish refuses the stored state", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)]);
  const fake = fakeStore(cells);
  const late: PublishStore = { ...fake.store, state: async () => ({ held: [], lastBatch: "2026-03", runMs: 0 }) };
  await assert.rejects(runDaily(late, JAN_10 + DAY));
  assert.deepEqual(fake.commits, []);
});
