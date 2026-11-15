import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type CellState, type StoredSample, publish, sessionKey, trimSession } from "./aggregate.js";
import { type DeletionStore, deleteSession } from "./delete-session.js";
import { type AggregationStore, SESSION_IDLE_MS, WRITE_MARGIN_MS, accumulateSessions, runHourly, sessionCellOf } from "./hourly.js";
import { HOUR, T, fakeAggregation, walk } from "./test-stores.js";

// A made-up second install.
const OTHER = "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67";

/** [fakeAggregation] with a [DeletionStore] over the same samples, private cells and tombstones. */
function fakeStores() {
  const fake = fakeAggregation();
  const matches = (d: { data: unknown }, installId: string, sessionId: string) =>
    (d.data as StoredSample).installId === installId && (d.data as StoredSample).sessionId === sessionId;
  const cellsOf = (key: string) => Object.keys(fake.cells).filter((id) => sessionCellOf(id).key === key);
  const deletion: DeletionStore = {
    stored: async (key, installId, sessionId) =>
      fake.deleted.has(key) || fake.docs.some((d) => matches(d, installId, sessionId)) || cellsOf(key).length > 0,
    bury: async (key) => void fake.deleted.add(key),
    deleteCells: async (key) => {
      for (const id of cellsOf(key)) Reflect.deleteProperty(fake.cells, id);
    },
    deleteSamples: async (installId, sessionId) => {
      const kept = fake.docs.filter((d) => !matches(d, installId, sessionId));
      fake.docs.splice(0, fake.docs.length, ...kept);
    },
  };
  return { ...fake, deletion };
}

/** The public cells of private [cells] keyed by session cell id. */
const published = (cells: Record<string, CellState>) =>
  publish(Object.entries(cells).map(([id, cell]) => [sessionCellOf(id).h3, cell] as const));

/** The private cells of [sessions], each trimmed. */
function expected(...sessions: StoredSample[][]): Record<string, CellState> {
  const cells: Record<string, CellState> = {};
  for (const session of sessions) accumulateSessions(cells, trimSession(session));
  return cells;
}

const aggregate = (store: AggregationStore, hours: number) => runHourly(store, T + WRITE_MARGIN_MS + hours * HOUR, Infinity);

test("deleting a session removes its raw samples and its effect on the private and public cells, and nothing else", async () => {
  const fake = fakeStores();
  const mine = walk(randomUUID(), 400);
  // Another install's session along the same walk, and another session of the same install.
  const theirs = walk(randomUUID(), 400).map((s) => ({ ...s, installId: OTHER }));
  const later = walk(randomUUID(), 400, -15.4);
  for (const session of [mine, theirs, later]) fake.receive(session, T);
  await aggregate(fake.store, SESSION_IDLE_MS / HOUR);
  assert.deepEqual(fake.cells, expected(mine, theirs, later));
  assert.notDeepEqual(published(fake.cells), published(expected(theirs, later)));

  const installId = mine[0]?.installId;
  const sessionId = mine[0]?.sessionId;
  assert.deepEqual(await deleteSession({ installId, sessionId }, fake.deletion), { status: 204 });
  assert.deepEqual(fake.cells, expected(theirs, later));
  assert.deepEqual(published(fake.cells), published(expected(theirs, later)));
  assert.equal(fake.docs.length, theirs.length + later.length);
  assert.ok(!fake.docs.some((d) => (d.data as StoredSample).sessionId === sessionId));
});

test("a request with another install's id deletes nothing and stores no tombstone", async () => {
  const fake = fakeStores();
  const mine = walk(randomUUID(), 400);
  fake.receive(mine, T);
  await aggregate(fake.store, SESSION_IDLE_MS / HOUR);
  const cells = structuredClone(fake.cells);
  assert.deepEqual(await deleteSession({ installId: OTHER, sessionId: mine[0]?.sessionId }, fake.deletion), { status: 204 });
  assert.deepEqual(fake.cells, cells);
  assert.equal(fake.docs.length, mine.length);
  assert.equal(fake.deleted.size, 0);
});

test("a deleted session's samples that arrive later, or while it is being aggregated, are never aggregated", async () => {
  const fake = fakeStores();
  const sessionId = randomUUID();
  const first = walk(sessionId, 300);
  const late = walk(sessionId, 300, -15.45, T);
  const installId = first[0]?.installId ?? "";
  fake.receive(first, T);
  await aggregate(fake.store, SESSION_IDLE_MS / HOUR);
  await deleteSession({ installId, sessionId }, fake.deletion);
  assert.deepEqual(fake.cells, {});
  assert.ok(fake.deleted.has(sessionKey(installId, sessionId)));

  // Samples of it stored anyway, as by an upload that was being written when it was deleted.
  fake.receive(late, T + 5 * HOUR);
  await aggregate(fake.store, 5 + SESSION_IDLE_MS / HOUR);
  assert.deepEqual(fake.cells, {});

  // A session deleted after a run read its samples and before the run committed.
  const other = walk(randomUUID(), 300, -16.5);
  fake.receive(other, T + 10 * HOUR);
  const racing: AggregationStore = {
    ...fake.store,
    commit: async (...args) => {
      await deleteSession({ installId, sessionId: other[0]?.sessionId }, fake.deletion);
      return fake.store.commit(...args);
    },
  };
  await aggregate(racing, 10 + SESSION_IDLE_MS / HOUR);
  assert.deepEqual(fake.cells, {});
});

test("a request whose body isn't an install id and a session id is refused", async () => {
  const fake = fakeStores();
  for (const body of [undefined, {}, { installId: randomUUID() }, { installId: "x", sessionId: randomUUID() }, { installId: randomUUID(), sessionId: randomUUID(), lat: 0 }]) {
    assert.equal((await deleteSession(body, fake.deletion)).status, 400);
  }
});
