// The hourly job: reads newly received samples and adds each ended session, trimmed, to the
// private cells. Its storage is behind [AggregationStore]; nothing here is public.
import { type CellState, type StoredSample, accumulate, sessionKey, trimSession } from "./aggregate.js";
import { SAMPLE_LIFETIME_MS } from "./ingest.js";
import { sampleErrors } from "./sample.js";

/** How long after the last sample of a session arrived the session counts as ended. */
export const SESSION_IDLE_MS = 3 * 3_600_000;

/**
 * How long after a sample's receive time the job first reads it. An upload's samples all carry the
 * `expireAt` of the time its request started; `ingest` starts no write later than
 * [WRITE_DEADLINE_MS] after that time, and each write is made in a Firestore transaction, which the
 * server ends [TRANSACTION_LIFETIME_MS] after it began. Those two add up to less than this margin,
 * so by then every sample with that `expireAt` or an earlier one is stored and the cursor never
 * passes a sample still being written. It also keeps a document written with a future `expireAt` from
 * moving the cursor ahead of samples not yet read.
 */
export const WRITE_MARGIN_MS = 10 * 60_000;

/** The most samples one page reads past the cursor; the next page reads on from where it stopped. */
export const READ_LIMIT = 10_000;

/**
 * The most samples of one session a page reads, about 14 hours of logging. A session with more
 * samples left than this is aggregated in parts, one part a page, each ending before the last
 * `expireAt` read and each trimmed at both ends like a whole session; so is one whose cells would
 * pass [CELL_LIMIT]. Where a real end's resting places lie is known only from the whole session,
 * and one can lie past a part's end, so each part's ends are cut as if they were real ones; a part
 * that ends while the phone is moving loses nothing there.
 */
export const SESSION_READ_LIMIT = 10_000;

/**
 * About the most private cells one page writes, so that its transaction stays well under Firestore's
 * 10 MiB request limit. Samples are added an `expireAt` at a time while their cells before trimming
 * are fewer than this, so a page writes at most one upload's samples ([MAX_BATCH]) past it. A page
 * always aggregates at least one ended session or part of one.
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
  /**
   * Up to [limit] stored samples of session [sessionId], in `expireAt` order, whose `expireAt` is
   * at least [fromMs] and at most [notAfterMs].
   */
  sessionSamples(sessionId: string, fromMs: number, notAfterMs: number, limit: number): Promise<Stored[]>;
  /**
   * In one transaction, if the stored state still equals [expected]: reads the private cells [ids]
   * (one that doesn't exist as `{}`) and which of their sessions were deleted, lets [update] change
   * the cells, given the [sessionKey]s of those deleted, and writes [next] and the cells of every
   * session not deleted. Returns whether it wrote anything.
   */
  commit(
    expected: HourlyState,
    next: HourlyState,
    ids: string[],
    update: (cells: Record<string, CellState>, deleted: Set<string>) => void,
  ): Promise<boolean>;
}

/**
 * The id of the private cell that holds the contribution of the session with [sessionKey] [key] to
 * the H3 cell [h3]: each session's contribution is kept apart, so that it can be deleted whole.
 */
export const sessionCellId = (key: string, h3: string) => `${key}_${h3}`;

/** The session key and the H3 cell of the private cell [id]. */
export function sessionCellOf(id: string): { key: string; h3: string } {
  const [key = "", h3 = ""] = id.split("_");
  return { key, h3 };
}

/**
 * Adds trimmed samples to [cells] as [accumulate] does, each session's to the private cells of its
 * own, keyed by [sessionCellId]. Changes [cells] in place.
 */
export function accumulateSessions(cells: Record<string, CellState>, samples: StoredSample[]): void {
  const sessions = new Map<string, StoredSample[]>();
  for (const s of samples) {
    const key = sessionKey(s.installId, s.sessionId);
    const own = sessions.get(key) ?? [];
    own.push(s);
    sessions.set(key, own);
  }
  for (const [key, own] of sessions) {
    const view: Record<string, CellState> = {};
    for (const [id, cell] of Object.entries(cells)) {
      const of = sessionCellOf(id);
      if (of.key === key) view[of.h3] = cell;
    }
    accumulate(view, own);
    for (const [h3, cell] of Object.entries(view)) cells[sessionCellId(key, h3)] = cell;
  }
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
 * One run at [nowMs]: pages, each read and committed on its own, until a page reads fewer than
 * [READ_LIMIT] samples and leaves no ended session open, so the run has read every sample received
 * up to [WRITE_MARGIN_MS] ago and aggregated every session that had ended by then, or until a page
 * ends at or after [deadlineMs] by `Date.now()`. Always runs at least one page. Throws when another
 * run changed the state since a page read it; the pages before that one stay written.
 */
export async function runHourly(
  store: AggregationStore,
  nowMs: number,
  deadlineMs: number,
): Promise<void> {
  for (;;) {
    const more = await runPage(store, nowMs);
    if (!more || Date.now() >= deadlineMs) return;
  }
}

/**
 * One page of a run at [nowMs]. Reads up to [READ_LIMIT] samples received since the last page up
 * to [WRITE_MARGIN_MS] ago, and each session that has had no new sample for [SESSION_IDLE_MS] is
 * read whole, from its first sample not yet aggregated to the last one read, trimmed at both ends
 * with [trimSession] and added to the private cells, until about [CELL_LIMIT] cells are written;
 * the session that reaches the limit is added only up to it, as a part trimmed the same way, and
 * the rest of it and the other sessions stay open for a later page. A session too long to read
 * whole is left for after the others, and then, if fewer than [CELL_LIMIT] cells are written, one
 * part of it is added the same way and the rest stays open; [SESSION_READ_LIMIT] or more samples of one session sharing one `expireAt` (more
 * than any upload stores) are skipped, and their count logged. A session whose samples keep
 * arriving after it was aggregated is aggregated again from those samples only, and trimmed again,
 * so no sample is counted twice. Each session goes to private cells of its own, [sessionCellId],
 * and nothing of a deleted session is added. Samples whose `expireAt` has passed are never read. Throws,
 * writing nothing, when another run changed the state since this page read it. Returns whether it
 * read [READ_LIMIT] samples or left an ended session open. A page that leaves one open has added
 * part of an ended session or skipped samples of one, so the next page starts further on.
 */
async function runPage(store: AggregationStore, nowMs: number): Promise<boolean> {
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
  // Every sample received up to this time, in expireAt terms, has been read. A page that stopped at
  // its read limit may have left samples at the cursor's expireAt unread, so it counts as read only
  // up to just before it.
  const readUntilMs = read.length < READ_LIMIT ? untilMs : (cursor?.expireAtMs ?? 0) - 1;

  const trimmed: StoredSample[] = [];
  const ids = new Set<string>();
  const add = (samples: StoredSample[]) => {
    const kept = trimSession(samples);
    const cells: Record<string, CellState> = {};
    accumulateSessions(cells, kept);
    for (const id of Object.keys(cells)) ids.add(id);
    trimmed.push(...kept);
  };
  // Whether the cells of the samples added so far, before trimming, reached CELL_LIMIT.
  let full = false;
  /**
   * Adds [docs], in `expireAt` order, from the first up to the first `expireAt` reached once the
   * cells of the samples added before trimming are [CELL_LIMIT] or more. Returns how many it added.
   */
  const addFitting = (docs: Stored[], cursor: Cursor) => {
    const seen = new Set(ids);
    let end = 0;
    while (end < docs.length && seen.size < CELL_LIMIT) {
      let next = end + 1;
      while (docs[next]?.expireAtMs === docs[end]?.expireAtMs) next++;
      const cells: Record<string, CellState> = {};
      accumulateSessions(cells, validSamples(docs.slice(end, next), cursor));
      for (const id of Object.keys(cells)) seen.add(id);
      end = next;
    }
    full = seen.size >= CELL_LIMIT;
    add(validSamples(docs.slice(0, end), cursor));
    return end;
  };
  const done = new Set<string>();
  let oversized: { sessionId: string; session: OpenSession; docs: Stored[] } | undefined;
  for (const [sessionId, session] of Object.entries(open)) {
    if (readUntilMs - session.lastMs < SESSION_IDLE_MS) continue;
    if (full || !cursor) break;
    const docs = await store.sessionSamples(sessionId, Math.max(session.fromMs, nowMs + 1), cursor.expireAtMs, SESSION_READ_LIMIT);
    if (docs.length < SESSION_READ_LIMIT) {
      const end = addFitting(docs, cursor);
      if (end === docs.length) done.add(sessionId);
      else open[sessionId] = { ...session, fromMs: docs[end]?.expireAtMs ?? session.fromMs };
    } else {
      oversized ??= { sessionId, session, docs };
    }
  }
  if (oversized && cursor && !full) {
    const { sessionId, session, docs } = oversized;
    // More samples may share the last expireAt read, so the part ends before it.
    const endMs = docs.at(-1)?.expireAtMs ?? session.fromMs;
    const end = addFitting(docs.filter((doc) => doc.expireAtMs < endMs), cursor);
    if (end > 0) {
      open[sessionId] = { ...session, fromMs: docs[end]?.expireAtMs ?? endMs };
    } else {
      console.warn(`runHourly: skipped at least ${docs.length} samples of one session that share one expireAt`);
      open[sessionId] = { ...session, fromMs: endMs + 1 };
    }
  }

  const next = { cursor, open: Object.fromEntries(Object.entries(open).filter(([id]) => !done.has(id))) };
  const update = (cells: Record<string, CellState>, deleted: Set<string>) =>
    accumulateSessions(cells, trimmed.filter((s) => !deleted.has(sessionKey(s.installId, s.sessionId))));
  if (!(await store.commit(state, next, [...ids], update))) {
    throw new Error("runHourly: the state changed during the run; this page wrote nothing");
  }
  return read.length === READ_LIMIT || Object.values(next.open).some((session) => readUntilMs - session.lastMs >= SESSION_IDLE_MS);
}
