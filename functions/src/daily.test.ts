import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { cellToParent, latLngToCell } from "h3-js";
import { type CellState, type PublicCell, type StoredSample, CELL_RESOLUTION, TILE_RESOLUTION, accumulate, publish } from "./aggregate.js";
import { CELLS_PER_WRITE, type DailyState, type PublishStore, runDaily } from "./daily.js";
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
 * A [PublishStore] in memory that refuses a write of more than [CELLS_PER_WRITE] cells, and records
 * each commit's state with the public cells staged under it, and each tile file as the text that
 * would be stored.
 */
function fakeStore(cells: Record<string, CellState>) {
  let state: DailyState = { held: [], lastBatch: null, runMs: null };
  const published: Record<string, PublicCell> = {};
  const staged = new Map<number, Record<string, PublicCell>>();
  const commits: { next: DailyState; changed: Record<string, PublicCell> }[] = [];
  const files = new Map<string, string>();
  const bounded = (written: Record<string, PublicCell>) => {
    if (Object.keys(written).length > CELLS_PER_WRITE) throw new Error("request too large");
  };
  const store: PublishStore = {
    writeTile: async (tile, tileCells) => {
      files.set(tile, JSON.stringify(tileCells));
    },
    privateCells: async () => structuredClone(cells),
    state: async () => structuredClone(state),
    publicCells: async () => structuredClone(published),
    stage: async (runMs, written) => {
      bounded(written);
      staged.set(runMs, { ...staged.get(runMs), ...structuredClone(written) });
    },
    staged: async (runMs) => structuredClone(staged.get(runMs) ?? {}),
    commit: async (expected, next) => {
      if (!isDeepStrictEqual(state, expected)) return false;
      commits.push(structuredClone({ next, changed: staged.get(next.runMs ?? -1) ?? {} }));
      state = structuredClone(next);
      return true;
    },
    writePublic: async (runMs, written) => {
      bounded(written);
      if (state.runMs !== runMs) return false;
      Object.assign(published, structuredClone(written));
      return true;
    },
    dropStaged: async (runMs) => {
      for (const run of staged.keys()) if (run <= runMs) staged.delete(run);
    },
  };
  return { store, published, staged, commits, files, state: () => state };
}

/** Private cells that publish [n] public cells, each seen by two installs, on the first run. */
function manySharedCells(n: number): Record<string, CellState> {
  const cells: Record<string, CellState> = {};
  for (let i = 0; i < n; i++) {
    const fix = { ...sample(INSTALL_ID, JAN_10).fix, lat: PLACE.lat - i * 0.001 };
    accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)].map((s) => ({ ...s, fix })));
  }
  return cells;
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

test("each run stores held and lastBatch once the public cells that changed are staged under it", async () => {
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

test("a run that changes more cells than one write holds stores the state and public cells publish returned", async () => {
  const cells = manySharedCells(2 * CELLS_PER_WRITE + 1);
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  const expected = publish(cells, [], {}, null, JAN_10 + DAY);
  assert.equal(Object.keys(expected.published).length, 2 * CELLS_PER_WRITE + 1);
  assert.deepEqual(fake.state(), { held: expected.held, lastBatch: expected.lastBatch, runMs: JAN_10 + DAY });
  assert.deepEqual(fake.published, expected.published);
  assert.equal(fake.staged.size, 0);
});

test("a run that stops while staging leaves the state and public cells as they were", async () => {
  const cells = manySharedCells(CELLS_PER_WRITE + 1);
  const fake = fakeStore(cells);
  let stages = 0;
  const failing: PublishStore = {
    ...fake.store,
    stage: (runMs, written) => (++stages > 1 ? Promise.reject(new Error("unavailable")) : fake.store.stage(runMs, written)),
  };
  await assert.rejects(runDaily(failing, JAN_10 + DAY), /unavailable/);
  assert.deepEqual(fake.state(), { held: [], lastBatch: null, runMs: null });
  assert.deepEqual(fake.published, {});
  assert.equal(fake.files.size, 0);

  await runDaily(fake.store, JAN_10 + 2 * DAY);
  assert.deepEqual(fake.published, publish(cells, [], {}, null, JAN_10 + 2 * DAY).published);
  assert.equal(fake.staged.size, 0);
});

test("the next run first finishes copying the cells of a run that stopped after storing its state", async () => {
  const cells = manySharedCells(CELLS_PER_WRITE + 1);
  const fake = fakeStore(cells);
  let writes = 0;
  const failing: PublishStore = {
    ...fake.store,
    writePublic: (runMs, written) => (++writes > 1 ? Promise.reject(new Error("unavailable")) : fake.store.writePublic(runMs, written)),
  };
  await assert.rejects(runDaily(failing, JAN_10 + DAY), /unavailable/);
  const expected = publish(cells, [], {}, null, JAN_10 + DAY);
  assert.deepEqual(fake.state(), { held: expected.held, lastBatch: expected.lastBatch, runMs: JAN_10 + DAY });
  assert.equal(Object.keys(fake.published).length, CELLS_PER_WRITE);

  let previous: Record<string, PublicCell> = {};
  const reading: PublishStore = { ...fake.store, publicCells: async () => (previous = await fake.store.publicCells()) };
  await runDaily(reading, JAN_10 + 2 * DAY);
  assert.deepEqual(previous, expected.published);
  assert.deepEqual(fake.commits.at(-1)?.changed, {});
  assert.equal(fake.staged.size, 0);
});

test("a run doesn't copy its cells into the public cells once another run stored its state", async () => {
  const fake = fakeStore(sharedCells());
  let copied = 0;
  const overtaken: PublishStore = {
    ...fake.store,
    commit: async (expected, next) => {
      const stored = await fake.store.commit(expected, next);
      await runDaily(fake.store, JAN_10 + 2 * DAY);
      return stored;
    },
    writePublic: async (runMs, written) => {
      const wrote = await fake.store.writePublic(runMs, written);
      if (wrote) copied++;
      return wrote;
    },
  };
  await assert.rejects(runDaily(overtaken, JAN_10 + DAY), /the state changed/);
  assert.equal(copied, 0);
  assert.equal(fake.state().runMs, JAN_10 + 2 * DAY);
  assert.equal(fake.staged.size, 0);
});
