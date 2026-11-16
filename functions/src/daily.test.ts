import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { cellToParent, latLngToCell } from "h3-js";
import {
  type CellState,
  type PublicCell,
  type StoredSample,
  CELL_RESOLUTION,
  OVERVIEW_RESOLUTIONS,
  TILE_RESOLUTION,
  accumulate,
  overview,
  publish,
} from "./aggregate.js";
import { CELLS_PER_WRITE, type DailyState, type PublishStore, dailyState, runDaily } from "./daily.js";
import { INSTALL_ID, testSample } from "./test-sample.js";

// A made-up second install and place.
const OTHER = "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67";
const PLACE = { lat: -15.5, lon: -47.5 };
const JAN_10 = Date.UTC(2026, 0, 10, 13);
const DAY = 86_400_000;

const h3 = latLngToCell(PLACE.lat, PLACE.lon, CELL_RESOLUTION);
const tile = cellToParent(h3, TILE_RESOLUTION);

function sample(installId: string, timeMs: number): StoredSample {
  const s = testSample() as unknown as StoredSample;
  return { ...s, installId, timeMs, fix: { ...s.fix, ...PLACE } };
}

/**
 * A [PublishStore] in memory, from the state [stored], that refuses a write of more than [CELLS_PER_WRITE] cells, and records
 * each commit's state with the public cells staged under it, and each tile and overview file as
 * the text that would be stored.
 */
function fakeStore(cells: Record<string, CellState>, stored: DailyState = { runMs: null, tiles: [] }) {
  let state = stored;
  const published: Record<string, PublicCell> = {};
  const staged = new Map<number, Record<string, PublicCell | null>>();
  const commits: { next: DailyState; changed: Record<string, PublicCell | null> }[] = [];
  const files = new Map<string, string>();
  const overviews = new Map<number, string>();
  const bounded = (written: Record<string, PublicCell | null>) => {
    if (Object.keys(written).length > CELLS_PER_WRITE) throw new Error("request too large");
  };
  const store: PublishStore = {
    writeTile: async (tile, tileCells) => {
      files.set(tile, JSON.stringify(tileCells));
    },
    writeOverview: async (resolution, cells) => {
      overviews.set(resolution, JSON.stringify(cells));
    },
    privateCells: async () => structuredClone(Object.entries(cells)),
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
      for (const [id, cell] of Object.entries(structuredClone(written))) {
        if (cell) published[id] = cell;
        else Reflect.deleteProperty(published, id);
      }
      return true;
    },
    dropStaged: async (runMs) => {
      for (const run of staged.keys()) if (run <= runMs) staged.delete(run);
    },
  };
  return { store, published, staged, commits, files, overviews, state: () => state };
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

test("a public cell no private cell backs any more is deleted, and its tile written empty until a write succeeds", async () => {
  const cells = sharedCells();
  const far = { ...sample(INSTALL_ID, JAN_10), fix: { ...sample(INSTALL_ID, JAN_10).fix, lat: -20.5, lon: -42.5 } };
  const farCells: Record<string, CellState> = {};
  accumulate(farCells, [far]);
  const fake = fakeStore({ ...cells, ...farCells });
  await runDaily(fake.store, JAN_10 + DAY);
  const farTile = cellToParent(Object.keys(publish(Object.entries(farCells)))[0] ?? "", TILE_RESOLUTION);
  assert.deepEqual([...fake.files.keys()].sort(), [tile, farTile].sort());

  // The far cell's session is deleted: the same stores, without its private cells.
  const without = fakeStore(cells, fake.state());
  Object.assign(without.published, fake.published);
  const failing: PublishStore = {
    ...without.store,
    writeTile: (name, tileCells) => (name === farTile ? Promise.reject(new Error("unavailable")) : without.store.writeTile(name, tileCells)),
  };
  await assert.rejects(runDaily(failing, JAN_10 + 2 * DAY), /1 of 6 tile and overview writes failed/);
  assert.deepEqual(without.published, publish(Object.entries(cells)));
  await runDaily(without.store, JAN_10 + 3 * DAY);
  assert.equal(without.files.get(farTile), "[]");
  assert.equal(without.files.get(tile), JSON.stringify([without.published[h3]]));
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
  await assert.rejects(runDaily(flaky, JAN_10 + DAY), /1 of 6 tile and overview writes failed/);
  assert.equal(fake.commits.length, 1);
  assert.equal(fake.files.size, 1);
  assert.ok(!fake.files.has(failing));
});

test("each run writes the overview at every resolution over all the public cells, and empty once none is left", async () => {
  const cells = sharedCells();
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  assert.deepEqual([...fake.overviews.keys()], [...OVERVIEW_RESOLUTIONS]);
  for (const resolution of OVERVIEW_RESOLUTIONS) {
    assert.equal(fake.overviews.get(resolution), JSON.stringify(overview(fake.published, resolution)));
    assert.deepEqual(JSON.parse(fake.overviews.get(resolution) ?? "").map((cell: PublicCell) => cell.h3), [cellToParent(h3, resolution)]);
  }

  const emptied = fakeStore({}, fake.state());
  Object.assign(emptied.published, fake.published);
  await runDaily(emptied.store, JAN_10 + 2 * DAY);
  for (const resolution of OVERVIEW_RESOLUTIONS) assert.equal(emptied.overviews.get(resolution), "[]");
});

test("a failed overview write doesn't stop the others, and the run then throws", async () => {
  const fake = fakeStore(sharedCells());
  const [failing, ...others] = OVERVIEW_RESOLUTIONS;
  const flaky: PublishStore = {
    ...fake.store,
    writeOverview: (resolution, cells) => (resolution === failing ? Promise.reject(new Error("unavailable")) : fake.store.writeOverview(resolution, cells)),
  };
  await assert.rejects(runDaily(flaky, JAN_10 + DAY), /1 of 5 tile and overview writes failed/);
  assert.deepEqual([...fake.overviews.keys()], others);
  assert.deepEqual([...fake.files.keys()], [tile]);
});

test("a cell seen by one install is public after the next run, and gains a later visit the run after", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10)]);
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  assert.deepEqual(fake.commits, [{ next: { runMs: JAN_10 + DAY, tiles: [tile] }, changed: publish(Object.entries(cells)) }]);
  assert.deepEqual(Object.keys(fake.published), [h3]);

  accumulate(cells, [sample(INSTALL_ID, Date.UTC(2026, 1, 3, 13))]);
  await runDaily(fake.store, Date.UTC(2026, 1, 4, 0, 30));
  assert.equal(fake.published[h3]?.lastSeen, "2026-02");
  assert.deepEqual(fake.published, publish(Object.entries(cells)));
});

test("a stored state that still lists held cells is read as its run, and the next run publishes them", async () => {
  const runMs = JAN_10 + DAY;
  assert.deepEqual(dailyState({ held: [h3], lastBatch: "2026-01", runMs }), { runMs, tiles: [] });
  assert.deepEqual(dailyState(undefined), { runMs: null, tiles: [] });

  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10)]);
  const fake = fakeStore(cells, dailyState({ held: [h3], lastBatch: "2026-01", runMs }));
  await runDaily(fake.store, runMs + DAY);
  assert.deepEqual(fake.state(), { runMs: runMs + DAY, tiles: [tile] });
  assert.deepEqual(Object.keys(fake.published), [h3]);
  assert.deepEqual(JSON.parse(fake.files.get(cellToParent(h3, TILE_RESOLUTION)) ?? ""), [fake.published[h3]]);
});

test("a run that changes no public cell writes only the state", async () => {
  const cells: Record<string, CellState> = {};
  accumulate(cells, [sample(INSTALL_ID, JAN_10), sample(OTHER, JAN_10)]);
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  assert.deepEqual(Object.keys(fake.commits[0]?.changed ?? {}), [h3]);
  await runDaily(fake.store, JAN_10 + 2 * DAY);
  assert.deepEqual(fake.commits[1], { next: { runMs: JAN_10 + 2 * DAY, tiles: [tile] }, changed: {} });
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

test("a run that changes more cells than one write holds stores the state and public cells publish returned", async () => {
  const cells = manySharedCells(2 * CELLS_PER_WRITE + 1);
  const fake = fakeStore(cells);
  await runDaily(fake.store, JAN_10 + DAY);
  const expected = publish(Object.entries(cells));
  assert.equal(Object.keys(expected).length, 2 * CELLS_PER_WRITE + 1);
  assert.equal(fake.state().runMs, JAN_10 + DAY);
  assert.deepEqual(fake.published, expected);
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
  assert.deepEqual(fake.state(), { runMs: null, tiles: [] });
  assert.deepEqual(fake.published, {});
  assert.equal(fake.files.size, 0);

  await runDaily(fake.store, JAN_10 + 2 * DAY);
  assert.deepEqual(fake.published, publish(Object.entries(cells)));
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
  const expected = publish(Object.entries(cells));
  assert.equal(fake.state().runMs, JAN_10 + DAY);
  assert.equal(Object.keys(fake.published).length, CELLS_PER_WRITE);

  let previous: Record<string, PublicCell> = {};
  const reading: PublishStore = { ...fake.store, publicCells: async () => (previous = await fake.store.publicCells()) };
  await runDaily(reading, JAN_10 + 2 * DAY);
  assert.deepEqual(previous, expected);
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
