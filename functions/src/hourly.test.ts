import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { getResolution } from "h3-js";
import { type CellState, type StoredSample, PRIVATE_RESOLUTION, accumulate, trimSession } from "./aggregate.js";
import {
  CELL_LIMIT,
  type AggregationStore,
  type HourlyState,
  READ_LIMIT,
  SESSION_IDLE_MS,
  SESSION_READ_LIMIT,
  type Stored,
  WRITE_MARGIN_MS,
  runHourly,
} from "./hourly.js";
import { SAMPLE_LIFETIME_MS, WRITE_DEADLINE_MS } from "./ingest.js";
import { MAX_BATCH } from "./sample.js";
import { TRANSACTION_LIFETIME_MS } from "./create-missing.js";
import { testSample } from "./test-sample.js";

const T = Date.UTC(2026, 0, 10, 12);
const HOUR = 3_600_000;

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
    sessionSamples: async (sessionId, fromMs, notAfterMs, limit) =>
      structuredClone(
        docs
          .filter((d) => (d.data as StoredSample).sessionId === sessionId && d.expireAtMs >= fromMs && d.expireAtMs <= notAfterMs)
          .sort((a, b) => a.expireAtMs - b.expireAtMs)
          .slice(0, limit),
      ),
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

/** [samples] moved onto a path back and forth along 2 km from [fromLat], so they cover well under [CELL_LIMIT] private cells. */
function shuttle(samples: StoredSample[], fromLat = -15.5) {
  return samples.map((s, i) => ({ ...s, fix: { ...s.fix, lat: fromLat + Math.abs((i % 400) - 200) * 0.00009 } }));
}

/** The private cells of [sessions], each trimmed with [trimSession]. */
function expected(...sessions: StoredSample[][]): Record<string, CellState> {
  const cells: Record<string, CellState> = {};
  for (const session of sessions) accumulate(cells, trimSession(session));
  return cells;
}

test("a session is added to the private cells, trimmed, once no sample of it has arrived for a while", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 400);
  fake.receive(session, T);

  await runHourly(fake.store, T + WRITE_MARGIN_MS + HOUR, Infinity);
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(Object.keys(fake.state().open), [session[0]?.sessionId]);

  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
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
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  fake.receive(later, T + 5 * HOUR);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 6 * HOUR, Infinity);
  assert.deepEqual(fake.cells, expected(first));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 5 * HOUR + SESSION_IDLE_MS, Infinity);
  assert.deepEqual(fake.cells, expected(first, later));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 24 * HOUR, Infinity);
  assert.deepEqual(fake.cells, expected(first, later));
});

test("a session is not aggregated while a run that stopped at its read limit may have left some of it unread", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 600);
  const other = shuttle(walk(randomUUID(), READ_LIMIT - 300), -16.5);
  fake.receive(session.slice(0, 300), T);
  for (let i = 0; i < other.length; i += MAX_BATCH) fake.receive(other.slice(i, i + MAX_BATCH), T + 1 + i / MAX_BATCH);
  fake.receive(session.slice(300), T + HOUR);
  // A deadline already passed: the run reads one page.
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, 0);
  assert.deepEqual(fake.cells, {});
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS + HOUR, Infinity);
  assert.ok(isDeepStrictEqual(fake.cells, expected(session, other)));
});

test("a session with samples past a read-limit cursor at that cursor's expireAt is aggregated whole", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 600);
  const other = walk(randomUUID(), READ_LIMIT - 300, -16.5);
  fake.receive(session.slice(0, 300), T);
  fake.receive(other, T + SESSION_IDLE_MS);
  fake.receive(session.slice(300), T + SESSION_IDLE_MS);
  // The session's later samples share the other upload's expireAt and come after it in read order.
  for (const doc of fake.docs.slice(-300)) doc.id = `~${doc.id}`;
  // A deadline already passed: the run reads one page, which stops at the other upload's last sample.
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, 0);
  assert.deepEqual(fake.cells, {});
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, Infinity);
  assert.ok(isDeepStrictEqual(fake.cells, expected(session, other)));
  assert.deepEqual(fake.state().open, {});
});

test("a run reads a backlog of several read limits in pages, each committed on its own", async () => {
  const fake = fakeStore();
  const backlog = walk(randomUUID(), 3 * READ_LIMIT);
  for (let i = 0; i < backlog.length; i += MAX_BATCH) fake.receive(backlog.slice(i, i + MAX_BATCH), T + i / MAX_BATCH);
  const [newest] = [...fake.docs].sort((a, b) => b.expireAtMs - a.expireAtMs || (a.id < b.id ? 1 : -1));
  let commits = 0;
  const store: AggregationStore = {
    ...fake.store,
    commit: (...args) => {
      commits++;
      return fake.store.commit(...args);
    },
  };
  await runHourly(store, T + WRITE_MARGIN_MS + HOUR, Infinity);
  assert.equal(commits, 4);
  assert.deepEqual(fake.state().cursor, { expireAtMs: newest?.expireAtMs, id: newest?.id });
});

test("a run whose deadline has passed reads one page", async () => {
  const fake = fakeStore();
  const backlog = walk(randomUUID(), 2 * READ_LIMIT);
  for (let i = 0; i < backlog.length; i += MAX_BATCH) fake.receive(backlog.slice(i, i + MAX_BATCH), T + i / MAX_BATCH);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + HOUR, 0);
  assert.equal(fake.state().cursor?.expireAtMs, T + (READ_LIMIT / MAX_BATCH - 1) + SAMPLE_LIFETIME_MS);
});

test("a run keeps paging until every ended session past the cell limit is aggregated", async () => {
  const fake = fakeStore();
  // About 20 m a fix, so each walk covers well over CELL_LIMIT private cells.
  const long = (from: number) => walk(randomUUID(), CELL_LIMIT * 2, from).map((s, i) => ({ ...s, fix: { ...s.fix, lat: from + i * 0.00018 } }));
  const [a, b, c] = [long(-15.5), long(-14.5), long(-13.5)];
  for (const session of [a, b, c]) {
    const own: Record<string, CellState> = {};
    accumulate(own, session);
    assert.ok(Object.keys(own).length > CELL_LIMIT);
    fake.receive(session, T);
  }
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  assert.deepEqual(fake.state().open, {});
  assert.ok(Object.keys(fake.cells).length > 3 * CELL_LIMIT);
});

test("a run ends when an ended session's samples have expired before it was aggregated", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 10);
  fake.receive(session, T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS, Infinity);
  assert.deepEqual(Object.keys(fake.state().open), [session[0]?.sessionId]);
  // Removed as Firestore's TTL would.
  fake.docs.length = 0;
  let pages = 0;
  const store: AggregationStore = {
    ...fake.store,
    commit: (...args) => {
      if (++pages > 2) throw new Error("the run kept paging");
      return fake.store.commit(...args);
    },
  };
  await runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  assert.equal(pages, 1);
  assert.deepEqual(fake.state().open, {});
  assert.deepEqual(fake.cells, {});
});

test("a run whose deadline has passed leaves the ended sessions past its one page's cell limit open", async () => {
  const fake = fakeStore();
  const long = (from: number) => walk(randomUUID(), CELL_LIMIT * 2, from).map((s, i) => ({ ...s, fix: { ...s.fix, lat: from + i * 0.00018 } }));
  const [a, b] = [long(-15.5), long(-14.5)];
  fake.receive(a, T);
  fake.receive(b, T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, 0);
  const open = Object.keys(fake.state().open);
  const first = [a, b].filter((s) => !open.includes(s[0]?.sessionId ?? ""));
  assert.equal(open.length, 1);
  assert.equal(first.length, 1);
  assert.ok(isDeepStrictEqual(fake.cells, expected(...first)));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS + HOUR, Infinity);
  assert.ok(isDeepStrictEqual(fake.cells, expected(a, b)));
  assert.deepEqual(fake.state().open, {});
});

test("a session too long to read whole is aggregated in parts, without holding up other sessions", async () => {
  const fake = fakeStore();
  // Uploads of MAX_BATCH samples a minute apart.
  const huge = shuttle(walk(randomUUID(), 2 * SESSION_READ_LIMIT));
  for (let i = 0; i < huge.length; i += MAX_BATCH) fake.receive(huge.slice(i, i + MAX_BATCH), T + (i / MAX_BATCH) * 60_000);
  const other = walk(randomUUID(), 300, -16.5);
  fake.receive(other, T + HOUR);
  const run = (hours: number) => runHourly(fake.store, T + WRITE_MARGIN_MS + hours * HOUR, Infinity);
  for (let hours = 1; hours <= 3; hours++) await run(hours);
  assert.deepEqual(fake.cells, {});
  // A deadline already passed: the run reads one page, which adds the first part.
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 4 * HOUR, 0);
  // A part ends before the last expireAt it read: the upload there may be only partly read.
  const partLength = SESSION_READ_LIMIT - MAX_BATCH;
  const parts = [huge.slice(0, partLength), huge.slice(partLength, 2 * partLength), huge.slice(2 * partLength)];
  assert.ok(isDeepStrictEqual(fake.cells, expected(other, parts[0] ?? [])));
  assert.deepEqual(Object.keys(fake.state().open), [huge[0]?.sessionId]);
  await run(4);
  assert.ok(isDeepStrictEqual(fake.cells, expected(other, ...parts)));
  assert.deepEqual(fake.state().open, {});
  assert.equal(fake.state().cursor?.expireAtMs, T + HOUR + SAMPLE_LIFETIME_MS);
});

test("no page commits more than an upload's cells past the cell limit, and each sample counts once", async () => {
  const fake = fakeStore();
  // Uploads of MAX_BATCH samples a minute apart, 30 m apart, so each sample is in its own private cell.
  const huge = walk(randomUUID(), SESSION_READ_LIMIT).map((s, i) => ({ ...s, fix: { ...s.fix, lat: -15.5 + i * 0.00027 } }));
  for (let i = 0; i < huge.length; i += MAX_BATCH) fake.receive(huge.slice(i, i + MAX_BATCH), T + (i / MAX_BATCH) * 60_000);
  const own: Record<string, CellState> = {};
  accumulate(own, huge);
  assert.equal(Object.keys(own).length, huge.length);
  const written: number[] = [];
  const store: AggregationStore = {
    ...fake.store,
    commit: (expected, next, ids, update) => {
      written.push(ids.length);
      return fake.store.commit(expected, next, ids, update);
    },
  };
  for (let hours = SESSION_IDLE_MS / HOUR + 1; Object.keys(fake.state().open).length > 0 || written.length === 0; hours++) {
    assert.ok(hours < 24);
    await runHourly(store, T + WRITE_MARGIN_MS + hours * HOUR, Infinity);
  }
  assert.ok(written.filter((n) => n > 0).length > 1);
  for (const n of written) assert.ok(n <= CELL_LIMIT + MAX_BATCH, `${n} cells in one commit`);
  // The walk never rests, so no part's ends are cut, and every sample counts once.
  assert.ok(isDeepStrictEqual(fake.cells, own));
});

test("a long session aggregated in parts loses nothing where its parts end while moving", async () => {
  const fake = fakeStore();
  // Ten minutes at rest, then a walk north of SESSION_READ_LIMIT samples, each upload of MAX_BATCH
  // samples a minute after the one before, so the session is aggregated in parts.
  const session = walk(randomUUID(), 120 + SESSION_READ_LIMIT).map((s, i) => ({
    ...s,
    fix: { ...s.fix, lat: -15.5 + (i < 120 ? 0.00009 * Math.sin(i * 1.7) : (i - 120) * 0.00009) },
  }));
  for (let i = 0; i < session.length; i += MAX_BATCH) fake.receive(session.slice(i, i + MAX_BATCH), T + (i / MAX_BATCH) * 60_000);
  const first = SESSION_IDLE_MS / HOUR + 1;
  for (let hours = first; hours === first || Object.keys(fake.state().open).length > 0; hours++) {
    assert.ok(hours < 24);
    await runHourly(fake.store, T + WRITE_MARGIN_MS + hours * HOUR, Infinity);
  }
  assert.ok(Object.keys(fake.cells).length > CELL_LIMIT);
  assert.ok(isDeepStrictEqual(fake.cells, expected(session)));
});

test("more samples of one session than a run reads at one expireAt are skipped, not read again", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const fake = fakeStore();
  const sessionId = randomUUID();
  const later = walk(sessionId, 300, -15.45, T);
  fake.receive(walk(sessionId, SESSION_READ_LIMIT), T);
  fake.receive(later, T + 1);
  const other = walk(randomUUID(), 300, -16.5);
  fake.receive(other, T + 2);
  const run = (hours: number) => runHourly(fake.store, T + WRITE_MARGIN_MS + hours * HOUR, Infinity);
  await run(1);
  await run(SESSION_IDLE_MS / HOUR + 1);
  assert.ok(isDeepStrictEqual(fake.cells, expected(other, later)));
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!String(warn.mock.calls[0]?.arguments[0]).includes(sessionId));
  await run(SESSION_IDLE_MS / HOUR + 2);
  assert.ok(isDeepStrictEqual(fake.cells, expected(other, later)));
  assert.deepEqual(fake.state().open, {});
});

test("samples whose expiry has passed and documents that aren't valid samples are skipped", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T - SAMPLE_LIFETIME_MS - HOUR);
  fake.receive([{ sessionId: randomUUID(), fix: null }], T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(fake.state().open, {});
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
});

test("a run writes nothing when the state changed after it read it", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T);
  const store: AggregationStore = { ...fake.store, commit: (_expected, ...rest) => fake.store.commit({ cursor: null, open: { x: { fromMs: 0, lastMs: 0 } } }, ...rest) };
  await assert.rejects(runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity));
  assert.deepEqual(fake.cells, {});
  assert.deepEqual(fake.state(), { cursor: null, open: {} });
});

test("a run reads no sample received less than the write margin ago, nor one with a future expiry", async () => {
  const fake = fakeStore();
  const session = walk(randomUUID(), 300);
  fake.receive(session, T);
  fake.receive(walk(randomUUID(), 300), T + 1000 * 86_400_000);
  await runHourly(fake.store, T + WRITE_MARGIN_MS - 1, Infinity);
  assert.deepEqual(fake.state(), { cursor: null, open: {} });
  await runHourly(fake.store, T + WRITE_MARGIN_MS, Infinity);
  assert.equal(fake.state().cursor?.expireAtMs, T + SAMPLE_LIFETIME_MS);
  await runHourly(fake.store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
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
  await runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  assert.deepEqual(fake.cells, expected(first));
  await runHourly(fake.store, T + WRITE_MARGIN_MS + 2 * SESSION_IDLE_MS, Infinity);
  assert.deepEqual(fake.cells, expected(first, later));
});

test("a second run over the same state with no new sample writes nothing", async () => {
  const fake = fakeStore();
  fake.receive(walk(randomUUID(), 300), T);
  await runHourly(fake.store, T + WRITE_MARGIN_MS, Infinity);
  const before = fake.state();
  const store: AggregationStore = { ...fake.store, state: async () => structuredClone(before) };
  await runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity);
  const cells = structuredClone(fake.cells);
  assert.ok(Object.keys(cells).length > 0);
  await assert.rejects(runHourly(store, T + WRITE_MARGIN_MS + SESSION_IDLE_MS, Infinity));
  assert.deepEqual(fake.cells, cells);
});
