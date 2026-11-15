import assert from "node:assert/strict";
import { test } from "node:test";
import { tileLoader } from "./public/loader.js";

/**
 * A fake fetchTile whose fetches settle only when the test says so, counting calls per tile.
 * Settling a tile settles every fetch of it that is running, so no load is left waiting.
 */
function fakeFetch() {
  const calls = new Map();
  const open = new Map();
  const fetchTile = (tile) => {
    calls.set(tile, (calls.get(tile) ?? 0) + 1);
    return new Promise((resolve, reject) => {
      open.set(tile, [...(open.get(tile) ?? []), { resolve, reject }]);
    });
  };
  const take = (tile) => {
    const fetches = open.get(tile);
    assert.ok(fetches, `no fetch running for ${tile}`);
    open.delete(tile);
    return fetches;
  };
  return {
    fetchTile,
    calls,
    resolve: (tile, cells) => take(tile).forEach((f) => f.resolve(cells)),
    reject: (tile) => take(tile).forEach((f) => f.reject(new Error(`tile ${tile}: HTTP 503`))),
  };
}

const cell = (h3) => ({ h3, carriers: { "72405": { serviceN: 3, emergencyN: 0, noServiceN: 0 } } });

test("overlapping loads share one fetch per tile", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a", "b"]);
  const second = loader.load(["b", "c"]);
  assert.deepEqual([...fake.calls], [["a", 1], ["b", 1], ["c", 1]]);
  fake.resolve("a", [cell("a1")]);
  fake.resolve("b", [cell("b1")]);
  fake.resolve("c", []);
  await Promise.all([first, second]);
  assert.deepEqual([...loader.tiles.keys()].sort(), ["a", "b", "c"]);
  assert.deepEqual([...loader.cells.keys()].sort(), ["a1", "b1"]);
});

test("a load of stored tiles fetches nothing", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a"]);
  fake.resolve("a", [cell("a1")]);
  await first;
  assert.deepEqual(await loader.load(["a"]), { latest: true, failed: false });
  assert.equal(fake.calls.get("a"), 1);
});

test("only the latest load is reported as latest", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a"]);
  const second = loader.load(["b"]);
  fake.resolve("b", []);
  assert.deepEqual(await second, { latest: true, failed: false });
  fake.reject("a");
  assert.deepEqual(await first, { latest: false, failed: true });
});

test("a load is no longer latest once a load of no tiles follows it", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a"]);
  assert.deepEqual(await loader.load([]), { latest: true, failed: false });
  fake.resolve("a", []);
  assert.equal((await first).latest, false);
});

test("a load waiting on another load's fetch sees it fail", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a"]);
  const second = loader.load(["a"]);
  fake.reject("a");
  assert.deepEqual(await first, { latest: false, failed: true });
  assert.deepEqual(await second, { latest: true, failed: true });
});

test("a failed tile is not stored and the next load fetches it again", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a"]);
  fake.reject("a");
  assert.equal((await first).failed, true);
  assert.equal(loader.tiles.has("a"), false);
  const second = loader.load(["a"]);
  assert.equal(fake.calls.get("a"), 2);
  fake.resolve("a", [cell("a1")]);
  assert.deepEqual(await second, { latest: true, failed: false });
  assert.deepEqual(loader.tiles.get("a"), [cell("a1")]);
});

test("nothing is fetching once every fetch has settled", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a", "b"]);
  assert.deepEqual([...loader.fetching.keys()], ["a", "b"]);
  fake.resolve("a", []);
  fake.reject("b");
  await first;
  assert.equal(loader.fetching.size, 0);
});

test("the tiles that loaded are stored when another tile in the view fails", async () => {
  const fake = fakeFetch();
  const loader = tileLoader(fake.fetchTile);
  const first = loader.load(["a", "b", "c"]);
  fake.resolve("a", [cell("a1"), cell("a2")]);
  fake.reject("b");
  fake.resolve("c", [cell("c1")]);
  assert.deepEqual(await first, { latest: true, failed: true });
  assert.deepEqual([...loader.tiles.keys()].sort(), ["a", "c"]);
  assert.deepEqual([...loader.cells.keys()].sort(), ["a1", "a2", "c1"]);
});
