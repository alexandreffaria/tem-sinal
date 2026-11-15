// Deleting one session's recordings at the request of the phone that recorded it. Its storage is
// behind [DeletionStore].
import { sessionKey } from "./aggregate.js";
import { UUID } from "./sample.js";

/** Where a session's raw samples, private cells and tombstone are kept. */
export interface DeletionStore {
  /**
   * Whether anything of the session is stored: the tombstone of [key], a raw sample with both
   * [installId] and [sessionId], or a private cell of [key].
   */
  stored(key: string, installId: string, sessionId: string): Promise<boolean>;
  /** Stores the tombstone of the session with [sessionKey] [key]; it is kept for good. */
  bury(key: string): Promise<void>;
  /** Deletes every private cell of the session with [sessionKey] [key]. */
  deleteCells(key: string): Promise<void>;
  /** Deletes every raw sample with both [installId] and [sessionId]. */
  deleteSamples(installId: string, sessionId: string): Promise<void>;
}

export type DeletionResponse = { status: 204 } | { status: 400; body: { error: string } };

/**
 * Deletes the session that the request body `{"installId": ..., "sessionId": ...}` names: its
 * raw samples and its private cells, so the next daily run publishes the map as if it had never
 * been sent. Only the raw samples that carry that install id are deleted, so a request has an
 * effect only from a phone that holds the install id, which the app sends nowhere but in its
 * uploads; nothing of any other session or install is touched. A tombstone is stored first, so no
 * sample of the session is stored or aggregated again, even one still on the phone or being
 * aggregated now. Answers 204 whether or not anything was stored, so a request that failed part
 * way can be sent again; stores no tombstone when nothing of the session was stored.
 */
export async function deleteSession(body: unknown, store: DeletionStore): Promise<DeletionResponse> {
  const { installId, sessionId, ...rest } = (body ?? {}) as Record<string, unknown>;
  if (typeof installId !== "string" || !UUID.test(installId) || typeof sessionId !== "string" || !UUID.test(sessionId) || Object.keys(rest).length > 0) {
    return { status: 400, body: { error: "expected {installId, sessionId}, both lowercase version 4 UUIDs" } };
  }
  const key = sessionKey(installId, sessionId);
  if (await store.stored(key, installId, sessionId)) {
    await store.bury(key);
    await store.deleteCells(key);
    await store.deleteSamples(installId, sessionId);
  }
  return { status: 204 };
}
