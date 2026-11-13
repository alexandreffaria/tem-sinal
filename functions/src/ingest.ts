import { type Sample, validateBatch } from "./sample.js";

/** The most samples one install may upload in an hour: 40 full batches, over a day of logging. */
export const HOURLY_LIMIT = 20_000;

const HOUR_MS = 3_600_000;

/** Where uploads are counted and samples stored. */
export interface SampleStore {
  /**
   * Adds [count] to the install's uploads in the hour starting at [hourStartMs] and returns true,
   * or returns false and adds nothing when the total would pass [limit].
   */
  reserve(installId: string, hourStartMs: number, count: number, limit: number): Promise<boolean>;
  /** Stores each sample under its id; a sample whose id is already stored is left as it is. */
  create(samples: Sample[]): Promise<void>;
}

export interface Response {
  status: number;
  body: { error: string } | { accepted: number; rejected: { index: number; reasons: string[] }[] };
}

/**
 * Validates an upload body and stores its valid samples. A sample already stored counts as
 * accepted, so sending the same batch again is harmless.
 */
export async function ingest(body: unknown, store: SampleStore, nowMs: number): Promise<Response> {
  const batch = validateBatch(body);
  if (!batch.ok) return { status: 400, body: { error: batch.error } };
  const { valid, rejected } = batch;
  const [first] = valid;
  if (first) {
    const hourStartMs = nowMs - (nowMs % HOUR_MS);
    if (!(await store.reserve(first.installId, hourStartMs, valid.length, HOURLY_LIMIT))) {
      return { status: 429, body: { error: "too many samples from this install this hour" } };
    }
    await store.create(valid);
  }
  return { status: 200, body: { accepted: valid.length, rejected } };
}
