import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { StoredSample } from "./aggregate.js";
import { MAX_LISTED_SESSIONS, type SessionListStore, listSessions } from "./list-sessions.js";
import { T, walk } from "./test-stores.js";

// A made-up second install.
const OTHER = "7e4a1c90-3d2b-4f6e-8a5c-9b1d0e2f4a67";

/** A [SessionListStore] over [samples], answering as the Firestore queries do. */
function fakeStore(samples: StoredSample[]): SessionListStore {
  const of = (installId: string, sessionId: string) => samples.filter((s) => s.installId === installId && s.sessionId === sessionId);
  return {
    nextSession: async (installId, after) =>
      samples
        .filter((s) => s.installId === installId && (after === null || s.sessionId > after))
        .map((s) => s.sessionId)
        .sort()[0] ?? null,
    summary: async (installId, sessionId) => ({
      startMs: Math.min(...of(installId, sessionId).map((s) => s.timeMs)),
      samples: of(installId, sessionId).length,
    }),
  };
}

test("an install's sessions are listed with their first sample time and count, and another install's are not", async () => {
  const first = walk(randomUUID(), 30, -15.5, T - 5_000_000);
  const second = walk(randomUUID(), 12, -15.4, T);
  const theirs = walk(randomUUID(), 20).map((s) => ({ ...s, installId: OTHER }));
  const installId = first[0]?.installId;
  // Received out of order, as uploads in several batches are.
  const response = await listSessions({ installId }, fakeStore([...second.slice(6), ...theirs, ...first, ...second.slice(0, 6)]));

  assert.equal(response.status, 200);
  const sessions = response.status === 200 ? response.body.sessions : [];
  assert.deepEqual(
    sessions.toSorted((a, b) => a.startMs - b.startMs),
    [
      { sessionId: first[0]?.sessionId, startMs: T - 5_000_000, samples: 30 },
      { sessionId: second[0]?.sessionId, startMs: T, samples: 12 },
    ],
  );
  assert.deepEqual(Object.keys(sessions[0] ?? {}).sort(), ["samples", "sessionId", "startMs"]);
});

test("an install with no raw samples gets an empty list", async () => {
  const theirs = walk(randomUUID(), 20).map((s) => ({ ...s, installId: OTHER }));
  assert.deepEqual(await listSessions({ installId: randomUUID() }, fakeStore(theirs)), { status: 200, body: { sessions: [] } });
});

test("at most MAX_LISTED_SESSIONS sessions are listed", async () => {
  const installId = randomUUID();
  const samples = Array.from({ length: MAX_LISTED_SESSIONS + 5 }, () => ({ ...walk(randomUUID(), 1)[0], installId }) as StoredSample);
  const response = await listSessions({ installId }, fakeStore(samples));
  assert.equal(response.status === 200 && response.body.sessions.length, MAX_LISTED_SESSIONS);
});

test("a request whose body isn't one install id is refused", async () => {
  const store = fakeStore([]);
  for (const body of [undefined, {}, { installId: "x" }, { installId: randomUUID(), sessionId: randomUUID() }]) {
    assert.equal((await listSessions(body, store)).status, 400);
  }
});
