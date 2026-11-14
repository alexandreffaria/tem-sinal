// The hourly job: reads newly received samples and adds each ended session, trimmed, to the
// private cells. Its storage is behind [AggregationStore]; nothing here is public.
import { type CellState, type StoredSample, accumulate, trimLengths, trimSession } from "./aggregate.js";
import { SAMPLE_LIFETIME_MS } from "./ingest.js";
import { sampleErrors } from "./sample.js";

/** How long after the last sample of a session arrived the session counts as ended. */
export const SESSION_IDLE_MS = 3 * 3_600_000;

/**
 * How long after a sample's receive time the job first reads it. An upload's samples all carry the
 * `expireAt` of the time its request started, and the request is cut off 30 seconds later, so by
 * then every sample with that `expireAt` or an earlier one is stored and the cursor never passes a
 * sample still being written. It also keeps a document written with a future `expireAt` from
 * moving the cursor ahead of samples not yet read.
 */
export const WRITE_MARGIN_MS = 10 * 60_000;

/** The most samples one run reads past the cursor; the next run reads on from where it stopped. */
export const READ_LIMIT = 10_000;

/**
 * The most private cells one run writes, so that its transaction stays well under Firestore's
 * 10 MiB request limit. A run always aggregates at least one ended session, whatever its size.
 */
export const CELL_LIMIT = 2_000;

/** A stored sample's place in the read order: its `expireAt` in ms, then its document id. */
export type Cursor = { expireAtMs: number; id: string };

/** Whether [a] comes after [b] in the read order. */
const isAfter = (a: Cursor, b: Cursor) => a.expireAtMs > b.expireAtMs || (a.expireAtMs === b.expireAtMs && a.id > b.id);

/**
 * A session with samples read but not yet aggregated: the `expireAt` in ms of the first such
 * sample and of the latest one read.
 */
export type OpenSession = { fromMs: number; lastMs: number };

/**
 * What the job keeps between runs. Every sample at or before [cursor] in read order is either
 * aggregated or belongs to a session in [open]. Private: it lists session ids and receive times.
 */
export type HourlyState = { cursor: Cursor | null; open: Record<string, OpenSession> };

/** A stored document: its id, its `expireAt` in ms, and its other fields as stored. */
export type Stored = { id: string; expireAtMs: number; data: unknown };

/** Where the job reads samples and keeps its state and the private cells. */
export interface AggregationStore {
  state(): Promise<HourlyState>;
  /**
   * Up to [limit] stored samples, in read order, after [after] (from the first if null) and with
   * `expireAt` later than [notBeforeMs] and at most [notAfterMs].
   */
  samplesAfter(after: Cursor | null, notBeforeMs: number, notAfterMs: number, limit: number): Promise<Stored[]>;
  /** The stored samples of session [sessionId] whose `expireAt` is at least [fromMs]. */
  sessionSamples(sessionId: string, fromMs: number): Promise<Stored[]>;
  /**
   * In one transaction, if the stored state still equals [expected]: reads the private cells [ids]
   * (one that doesn't exist as `{}`), lets [update] change them, and writes them and [next].
   * Returns whether it wrote anything.
   */
  commit(
    expected: HourlyState,
    next: HourlyState,
    ids: string[],
    update: (cells: Record<string, CellState>) => void,
  ): Promise<boolean>;
}

/**
 * The valid samples among [docs] that are not after [cursor] in read order. A document that isn't
 * a valid sample (written straight to the collection rather than through the upload function) is
 * skipped.
 */
function validSamples(docs: Stored[], cursor: Cursor): StoredSample[] {
  return docs.flatMap((doc) => (!isAfter(doc, cursor) && sampleErrors(doc.data).length === 0 ? [doc.data as StoredSample] : []));
}

/**
 * One run at [nowMs]. Reads the samples received since the last run up to [WRITE_MARGIN_MS] ago,
 * and each session that has had no new sample for [SESSION_IDLE_MS] is read whole, from its first
 * sample not yet aggregated to the last one read, trimmed at both ends with [trimLengths] and
 * added to the private cells, until about [CELL_LIMIT] cells are written; the other sessions stay
 * open for a later run. A session whose samples keep arriving after it was aggregated is
 * aggregated again from those samples only, and trimmed again, so no sample is counted twice.
 * Samples whose `expireAt` has passed are never read. Throws, writing nothing, when another run
 * changed the state since this one read it.
 */
export async function runHourly(store: AggregationStore, nowMs: number, random: () => number = Math.random): Promise<void> {
  const state = await store.state();
  const untilMs = nowMs - WRITE_MARGIN_MS + SAMPLE_LIFETIME_MS;
  const read = await store.samplesAfter(state.cursor, nowMs, untilMs, READ_LIMIT);
  const open = { ...state.open };
  for (const { expireAtMs, data } of read) {
    if (sampleErrors(data).length > 0) continue;
    const { sessionId } = data as StoredSample;
    const session = open[sessionId];
    open[sessionId] = { fromMs: session?.fromMs ?? expireAtMs, lastMs: Math.max(session?.lastMs ?? expireAtMs, expireAtMs) };
  }
  const last = read.at(-1);
  const cursor = last ? { expireAtMs: last.expireAtMs, id: last.id } : state.cursor;
  // Every sample received up to this time, in expireAt terms, has been read.
  const readUntilMs = read.length < READ_LIMIT ? untilMs : (cursor?.expireAtMs ?? 0);

  const trimmed: StoredSample[] = [];
  const ids = new Set<string>();
  const done = new Set<string>();
  for (const [sessionId, session] of Object.entries(open)) {
    if (readUntilMs - session.lastMs < SESSION_IDLE_MS) continue;
    if (ids.size >= CELL_LIMIT || !cursor) break;
    const samples = validSamples(await store.sessionSamples(sessionId, Math.max(session.fromMs, nowMs + 1)), cursor);
    const { startM, endM } = trimLengths(random);
    const kept = trimSession(samples, startM, endM);
    const cells: Record<string, CellState> = {};
    accumulate(cells, kept);
    for (const id of Object.keys(cells)) ids.add(id);
    trimmed.push(...kept);
    done.add(sessionId);
  }

  const next = { cursor, open: Object.fromEntries(Object.entries(open).filter(([id]) => !done.has(id))) };
  if (!(await store.commit(state, next, [...ids], (cells) => accumulate(cells, trimmed)))) {
    throw new Error("runHourly: the state changed during the run; nothing was written");
  }
}
