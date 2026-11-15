import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CellState, StoredSample } from "./aggregate.js";
import { type AggregationStore, type HourlyState, type Stored, sessionCellOf } from "./hourly.js";
import { SAMPLE_LIFETIME_MS } from "./ingest.js";
import { testSample } from "./test-sample.js";

export const T = Date.UTC(2026, 0, 10, 12);
export const HOUR = 3_600_000;

/**
 * An [AggregationStore] in memory, ordering and filtering samples as the Firestore queries do,
 * with the private cells and the keys of the deleted sessions.
 */
export function fakeAggregation() {
  const docs: Stored[] = [];
  const cells: Record<string, CellState> = {};
  const deleted = new Set<string>();
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
      update(read, new Set(deleted));
      for (const id of ids) if (!deleted.has(sessionCellOf(id).key)) cells[id] = read[id] ?? {};
      state = structuredClone(next);
      return true;
    },
  };
  /** Stores [samples] as received at [receivedMs]. */
  const receive = (samples: object[], receivedMs: number) => {
    for (const data of samples) docs.push({ id: randomUUID(), expireAtMs: receivedMs + SAMPLE_LIFETIME_MS, data: structuredClone(data) });
  };
  return { store, receive, docs, cells, deleted, state: () => state };
}

/** A walk north of [length] valid samples 5 s and about 10 m apart, from [fromLat] at [startMs]. */
export function walk(sessionId: string, length: number, fromLat = -15.5, startMs = T - HOUR) {
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
