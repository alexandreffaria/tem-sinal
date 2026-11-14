import { type Sample, validateBatch } from "./sample.js";

/**
 * The most samples one install, and one Firebase Auth user, may upload in an hour: 40 full
 * batches, over a day of logging.
 */
export const HOURLY_LIMIT = 20_000;

const HOUR_MS = 3_600_000;

/**
 * How long a stored sample is kept after the server receives it (card 20261113bmjv). A TTL policy
 * on `signal_logs.expireAt` deletes it, typically within a day after that.
 */
export const SAMPLE_LIFETIME_MS = 90 * 86_400_000;

/**
 * How long after the server receives an upload its samples may still start being written. The
 * request is cut off after 30 seconds, but its code can keep running on a throttled instance.
 */
export const WRITE_DEADLINE_MS = 60_000;

/** Where uploads are counted and samples stored. */
export interface SampleStore {
  /**
   * Adds [count] to the install's and to the user's uploads in the hour starting at [hourStartMs]
   * and returns true, or returns false and adds nothing to either when either total would pass
   * [limit].
   */
  reserve(installId: string, uid: string, hourStartMs: number, count: number, limit: number): Promise<boolean>;
  /**
   * Stores each sample under its id; a sample whose id is already stored is left as it is. Rejects,
   * storing none, when the writes would start after [deadlineMs]; every write it makes is stored
   * before [deadlineMs] + [TRANSACTION_LIFETIME_MS].
   */
  create(samples: (Sample & { expireAt: Date })[], deadlineMs: number): Promise<void>;
}

export interface Response {
  status: number;
  body: { error: string } | { accepted: number; rejected: { index: number; reasons: string[] }[] };
}

/**
 * Validates an upload body from the Firebase Auth user [uid], received at [nowMs], and stores its
 * valid samples, each with `expireAt` [SAMPLE_LIFETIME_MS] after [nowMs]. The uid is used only to
 * count uploads; it is never stored on a sample. A sample already stored counts as accepted and
 * keeps its first `expireAt`, so sending the same batch again is harmless. Rejects, so that the
 * request fails and the phone keeps the batch, when the store would start writing more than
 * [WRITE_DEADLINE_MS] after [nowMs].
 */
export async function ingest(body: unknown, uid: string, store: SampleStore, nowMs: number): Promise<Response> {
  const batch = validateBatch(body);
  if (!batch.ok) return { status: 400, body: { error: batch.error } };
  const { valid, rejected } = batch;
  const [first] = valid;
  if (first) {
    const hourStartMs = nowMs - (nowMs % HOUR_MS);
    if (!(await store.reserve(first.installId, uid, hourStartMs, valid.length, HOURLY_LIMIT))) {
      return { status: 429, body: { error: "too many samples from this install or user this hour" } };
    }
    const expireAt = new Date(nowMs + SAMPLE_LIFETIME_MS);
    await store.create(
      valid.map((sample) => ({ ...sample, expireAt })),
      nowMs + WRITE_DEADLINE_MS,
    );
  }
  return { status: 200, body: { accepted: valid.length, rejected } };
}
