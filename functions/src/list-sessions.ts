// Listing the sessions the server holds raw samples of, at the request of the phone that sent
// them. Its storage is behind [SessionListStore].
import { UUID } from "./sample.js";

/**
 * The most sessions one request lists, in session id order, so that a request stays well inside
 * the function's timeout; far more than a phone records in the 90 days raw samples are kept.
 */
export const MAX_LISTED_SESSIONS = 200;

/** One listed session: its id, its earliest sample's `timeMs` and how many raw samples it has. */
export type ListedSession = { sessionId: string; startMs: number; samples: number };

/** Where the raw samples are kept. */
export interface SessionListStore {
  /** The smallest session id after [after] (any when null) among the raw samples with [installId], or null. */
  nextSession(installId: string, after: string | null): Promise<string | null>;
  /** The earliest `timeMs` and the count of the raw samples with both [installId] and [sessionId]. */
  summary(installId: string, sessionId: string): Promise<{ startMs: number; samples: number }>;
}

export type ListResponse = { status: 200; body: { sessions: ListedSession[] } } | { status: 400; body: { error: string } };

/**
 * Lists the sessions among the raw samples that carry the install id in the request body
 * `{"installId": ...}`, at most [MAX_LISTED_SESSIONS], in session id order: each one's id, first
 * sample time and sample count, and no coordinates. Only samples with that install id are read,
 * so a request learns something only from a phone that holds the install id, which the app sends
 * nowhere but in its uploads. A session whose raw samples have all expired isn't listed.
 */
export async function listSessions(body: unknown, store: SessionListStore): Promise<ListResponse> {
  const { installId, ...rest } = (body ?? {}) as Record<string, unknown>;
  if (typeof installId !== "string" || !UUID.test(installId) || Object.keys(rest).length > 0) {
    return { status: 400, body: { error: "expected {installId}, a lowercase version 4 UUID" } };
  }
  const ids: string[] = [];
  while (ids.length < MAX_LISTED_SESSIONS) {
    const next = await store.nextSession(installId, ids.at(-1) ?? null);
    if (next === null) break;
    ids.push(next);
  }
  const sessions = await Promise.all(ids.map(async (sessionId) => ({ sessionId, ...(await store.summary(installId, sessionId)) })));
  // A session whose last samples expired or were deleted since the walk found it has none left.
  return { status: 200, body: { sessions: sessions.filter((s) => s.samples > 0) } };
}
