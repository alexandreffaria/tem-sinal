import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { getResolution } from "h3-js";
import { type CellState, type StoredSample, PRIVATE_RESOLUTION, TRIM_M, accumulate, trimSession } from "./aggregate.js";
import {
  CELL_LIMIT,
  type AggregationStore,
  type HourlyState,
  READ_LIMIT,
  SESSION_IDLE_MS,
  type Stored,
  WRITE_MARGIN_MS,
  runHourly,
} from "./hourly.js";
import { SAMPLE_LIFETIME_MS, WRITE_DEADLINE_MS } from "./ingest.js";
import { TRANSACTION_LIFETIME_MS } from "./create-missing.js";
import { testSample } from "./test-sample.js";

const T = Date.UTC(2026, 0, 10, 12);
const HOUR = 3_600_000;
const NO_RANDOM = () => 0;

test("every sample is stored before the job reads past its expireAt", () => {
  assert.ok(WRITE_DEADLINE_MS + TRANSACTION_LIFETIME_MS < WRITE_MARGIN_MS);
});

/** An [AggregationStore] in memory, ordering and filtering samples as the Firestore queries do. */
function fakeStore() {
  const docs: Stored[] = [];
  const cells: Record<string, CellState> = {};
  let state: HourlyState = { cursor: null, open: {} };
  const order = (a: { expireAtMs: number; id: string }, b: { expireAtMs: number; id: string }) =>
    a.expireAtMs - b.expireAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const store: AggregationStore = {
    state: async () => structuredClone(state),
    samplesAfter: async (after, notBeforeMs, notAfterMs, limit) =>
      structuredClone(
        docs
          .filter((d) => d.expireAtMs > notBeforeMs && d.expireAtMs <= notAfterMs && (!after || order(d, after) > 0))
          .sort(order)
          .slice(0, limit),
      ),
    sessionSamples: async (sessionId, fromMs) =>
      structuredClone(docs.filter((d) => (d.data as StoredSample).sessionId === sessionId && d.expireAtMs >= fromMs)),
    commit: async (expected, next, ids, update) => {
      if (!isDeepStrictEqual(state, expected)) return false;
      const read = Object.fromEntries(ids.map((id) => [id, structuredClone(cells[id] ?? {})]));
      update(read);
      Object.assign(cells, read);
      state = structuredClone(next);
      return true;
    },
  };
  /** Stores [samples] as received at [receivedMs]. */
  const receive = (samples: object[], receivedMs: number) => {
    for (const data of samples) docs.push({ id: randomUUID(), expireAtMs: receivedMs + SAMPLE_LIFETIME_MS, data: structuredClone(data) });
  };
  return { store, receive, docs, cells, state: () => state };
}

/** A walk north of [length] valid samples 5 s and about 10 m apart, from [fromLat] at [startMs]. */
function walk(sessionId: string, length: number, fromLat = -15.5, startMs = T - HOUR) {
  return Array.from({ length }, (_, i) => {
    const s = testSample() as unknown as StoredSample;
    return {
      ...s,
      sessionId,
      timeMs: startMs + i * 5_000,
      elapsedRealtimeMs: 1_000_000 + i * 5_000,
      fix: { ...s.fix, lat: fromLat + i * 0.00009, timeMs: startMs + i * 5_000, elapsedRealtimeMs: 1_000_000 + i * 5_000 },
    };
  });
}

/** The private cells of [sessions], each trimmed by [TRIM_M.min] at both ends. */
function expected(...sessions: StoredSample[][]): Record<string, CellState> {
  const cells: Record<string, CellState> = {};
  for (const session of sessions) accumulate(cells, trimSession(session, TRIM_M.min, TRIM_M.min));
  return cells;
}

test("a session is added to the private cells, trimmed, once no sample of it has arrived for a while", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 400);
  fake.receive(session, T);

  await runHourly(fake.store, T + WRITE_MARGIN_MS + HOUR, NO_RANDOM);
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(Object.keys(fake.state().open), [session[0]?.sessionId]);

  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  assert.ok(Object.keys(fake.cells).length > 0);
  assert.deepEqual(fake.cells, expected(session));
  for (const h3 of Object.keys(fake.cells)) assert.equal(getResolution(h3), PRIVATE_RESOLUTION);
  assert.deepEqual(fake.state().open, {});
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
});

test("samples of a session that arrive after it was aggregated are added on their own, the earlier ones not again", async () => {
  const fake = fakeStore();
  const sessionId = randomUUID();
  const first = walk(sessionId, 300);
  const later = walk(sessionId, 300, -15.45, T);
  fake.receive(first, T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  fake.receive(later, T + 5 * HOUR);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 6 * HOUR, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(first));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 5 * HOUR + SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(first, later));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 24 * HOUR, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(first, later));
});

test("a session is not aggregated while a run that stopped at its read limit may have left some of it unread", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), READ_LIMIT + 1);
  fake.receive(session, T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, {});
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS + HOUR, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(session));
});

test("ended sessions past the cell limit wait for the next run", async () => {
  const fake = fakeStore();
  // About 20 m a fix, so each walk covers well over CELL_LIMIT private cells.
  const long = (from: number) => walk(randomUUID(), CELL_LIMIT * 2, from).map((s, i) => ({ ...s, fix: { ...s.fix, lat: from + i * 0.00018 } }));
  const [a, b] = [long(-15.5), long(-14.5)];
  fake.receive(a, T);
  fake.receive(b, T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  const open = Object.keys(fake.state().open);
  const first = [a, b].filter((s) => !open.includes(s[0]?.sessionId ?? ""));
  assert.equal(open.length, 1);
  assert.equal(first.length, 1);
  assert.ok(isDeepStrictEqual(fake.cells, expected(...first)));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS + HOUR, NO_RANDOM);
  assert.ok(isDeepStrictEqual(fake.cells, expected(a, b)));
  assert.deepEqual(fake.state().open, {});
});

test("samples whose expiry has passed and documents that aren't valid samples are skipped", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T - SAMPLE_LIFETIME_MS - HOUR);
  fake.receive([{ sessionId: randomUUID(), fix: null }], T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(fake.state().open, {});
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
});

test("a run writes nothing when the state changed after it read it", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T);
  const store: AggregationStore = { ...fake.store, commit: (_expected, ...rest) => fake.store.commit({ cursor: null, open: { x: { fromMs: 0, lastMs: 0 } } }, ...rest) };
  await assert.rejects(runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM));
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(fake.state(), { cursor: null, open: {} });
});

test("a run reads no sample received less than the write margin ago, nor one with a future expiry", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 300);
  fake.receive(session, T);
  fake.receive(walk(randomUUID(), 300), T + 1000 * 86_400_000);
  await runHourly(fake.store, T + WRITE_MARGIN_MS - 1, NO_RANDOM);
  assert.deepEqual(fake.state(), { cursor: null, open: {} });
  await runHourly(fake.store, T + WRITE_MARGIN_MS, NO_RANDOM);
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(session));
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
});

test("samples of an ended session that arrive after the run's read are aggregated once, in a later run", async () => {
  const fake = fakeStore();
  const sessionId = randomUUID();
  const first = walk(sessionId, 300);
  const later = walk(sessionId, 300, -15.45, T);
  fake.receive(first, T);
  // The later samples are stored between the run's read of new samples and its read of the session.
  const store: AggregationStore = {
    ...fake.store,
    sessionSamples: (...args) => {
      fake.receive(later, T + SESSION_IDLE_MS);
      return fake.store.sessionSamples(...args);
    },
  };
  await runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(first));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, NO_RANDOM);
  assert.deepEqual(fake.cells, expected(first, later));
});

test("a second run over the same state with no new sample writes nothing", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS, NO_RANDOM);
  const before = fake.state();
  const store: AggregationStore = { ...fake.store, state: async () => structuredClone(before) };
  await runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM);
  const cells = structuredClone(fake.cells);
  assert.ok(Object.keys(cells).length > 0);
  await assert.rejects(runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, NO_RANDOM));
  assert.deepEqual(fake.cells, cells);
});
