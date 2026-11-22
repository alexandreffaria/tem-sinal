import { type Sample, validateBatch } from "./sample.js";

/**
 * The most samples one install, and one Firebase Auth user, may upload in an hour: 40 full
 * batches, over a day of logging.
 */
export const HOURLY_LIMIT = 20_000;

const HOUR_MS = 3_600_000;

/**
 * The most bytes one upload's body may hold. A batch of 500 samples, 3.6 MB, took the
 * function to about 300 MiB against the Firestore emulator, and more in Cloud Run, so a body of
 * this size stays near half of the function's 512 MiB. The app splits its batches to fit:
 * `UPLOAD_BODY_LIMIT_BYTES` in `FirebaseUploader.kt` holds the same.
 */
export const MAX_BODY_BYTES = 2_000_000;

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
   * Stores each sample under its id; a sample whose id is already stored is left as it is, and one
   * of a deleted session (see [deleteSession]) is not stored. Rejects,
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
 * Validates an upload body of [bodyBytes] bytes from the Firebase Auth user [uid], received at
 * [nowMs], and refuses it whole, with 413, when it holds more than [MAX_BODY_BYTES]. Stores its
 * valid samples, each with `expireAt` [SAMPLE_LIFETIME_MS] after [nowMs]. The uid is used only to
 * count uploads; it is never stored on a sample. A sample already stored counts as accepted and
 * keeps its first `expireAt`, so sending the same batch again is harmless; one of a deleted session
 * counts as accepted too, so the phone drops it, and is never stored. Rejects, so that the
 * request fails and the phone keeps the batch, when the store would start writing more than
 * [WRITE_DEADLINE_MS] after [nowMs].
 */
export async function ingest(body: unknown, bodyBytes: number, uid: string, store: SampleStore, nowMs: number): Promise<Response> {
  if (bodyBytes > MAX_BODY_BYTES) return { status: 413, body: { error: `expected at most ${MAX_BODY_BYTES} bytes, got ${bodyBytes}` } };
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
