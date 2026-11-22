import { isDeepStrictEqual } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, type Query, type QueryDocumentSnapshot, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { type CellState, type PublicCell, sessionKey } from "./aggregate.js";
import { createMissing } from "./create-missing.js";
import { CELLS_PER_WRITE, type PublishStore, dailyState, runDaily } from "./daily.js";
import { type DeletionStore, deleteSession } from "./delete-session.js";
import { type AggregationStore, type HourlyState, type Stored, runHourly, sessionCellOf } from "./hourly.js";
import { type SampleStore, ingest } from "./ingest.js";
import { type SessionListStore, listSessions } from "./list-sessions.js";
import { readInChunks } from "./read-chunks.js";

// Every function runs as this account, which holds only what they use: Firestore through the
// Admin SDK, object writes in the default bucket, and log writes. Verifying App Check and Auth
// tokens fetches public keys and needs no role. The scheduled functions' Cloud Scheduler jobs
// call them with an OIDC token for this account, which is their only invoker.
setGlobalOptions({ serviceAccount: "functions-runtime@cellsignalmapper-a9da1.iam.gserviceaccount.com" });

initializeApp();
const db = getFirestore();

// The raw samples; the private cells, one per session and resolution 12 H3 cell, keyed by
// `sessionCellId`; and the tombstones of deleted sessions, keyed by `sessionKey`, with no fields.
// firestore.rules gives clients no access to any; only the functions, through the Admin SDK, use them.
const signalLogs = db.collection("signal_logs");
const privateCells = db.collection("session_cells");
const deletedSessions = db.collection("deleted_sessions");

/** How long a counter document is kept after its hour starts; a TTL policy on `expireAt` deletes it. */
const COUNTER_LIFETIME_MS = 2 * 3_600_000;

const firestoreStore: SampleStore = {
  reserve: (installId, uid, hourStartMs, count, limit) =>
    db.runTransaction(async (tx) => {
      const counters = await Promise.all(
        [
          { ref: db.collection("upload_counts").doc(`${installId}_${hourStartMs}`), owner: { installId } },
          { ref: db.collection("upload_counts").doc(`uid_${uid}_${hourStartMs}`), owner: { uid } },
        ].map(async (c) => ({ ...c, used: ((await tx.get(c.ref)).get("count") as number | undefined) ?? 0 })),
      );
      if (counters.some(({ used }) => used + count > limit)) return false;
      for (const { ref, owner, used } of counters) {
        tx.set(ref, { ...owner, hourStartMs, count: used + count, expireAt: new Date(hourStartMs + COUNTER_LIFETIME_MS) });
      }
      return true;
    }),
  create: (samples, deadlineMs) => {
    const docs = samples.map((sample) => ({
      ref: signalLogs.doc(sample.id),
      data: sample,
      unless: deletedSessions.doc(sessionKey(sample.installId, sample.sessionId as string)),
    }));
    return db.runTransaction((tx) => createMissing(tx, docs, deadlineMs));
  },
};

/**
 * What the App Check token on a request is: `valid`, `invalid` or `missing`. It is logged and not
 * enforced: Play Integrity can only attest an install from Google Play, and the app ships as an APK
 * from GitHub Releases, so every install today would be refused.
 */
async function appCheckVerdict(token: string | undefined): Promise<"valid" | "invalid" | "missing"> {
  if (!token) return "missing";
  try {
    await getAppCheck().verifyToken(token);
    return "valid";
  } catch {
    return "invalid";
  }
}

/** The Firebase Auth uid of a request that carries a valid Firebase Auth ID token, or undefined. */
async function verifiedUid(authorization: string | undefined): Promise<string | undefined> {
  const idToken = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!idToken) return undefined;
  try {
    return (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return undefined;
  }
}

/** How many documents one deletion batch removes. */
const DELETES_PER_BATCH = 400;

/** Deletes every document [query] matches, a batch at a time. */
async function deleteAll(query: FirebaseFirestore.Query): Promise<void> {
  for (;;) {
    const { docs } = await query.limit(DELETES_PER_BATCH).get();
    if (docs.length === 0) return;
    const batch = db.batch();
    for (const doc of docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

const sessionSamples = (installId: string, sessionId: string) =>
  signalLogs.where("sessionId", "==", sessionId).where("installId", "==", installId);

const deletionStore: DeletionStore = {
  stored: async (key, installId, sessionId) =>
    (await deletedSessions.doc(key).get()).exists ||
    !(await sessionSamples(installId, sessionId).limit(1).get()).empty ||
    !(await privateCells.where("owner", "==", key).limit(1).get()).empty,
  bury: async (key) => {
    await deletedSessions.doc(key).set({});
  },
  deleteCells: (key) => deleteAll(privateCells.where("owner", "==", key)),
  deleteSamples: (installId, sessionId) => deleteAll(sessionSamples(installId, sessionId)),
};

const sessionListStore: SessionListStore = {
  nextSession: async (installId, after) => {
    let query = signalLogs.where("installId", "==", installId).orderBy("sessionId");
    if (after !== null) query = query.startAfter(after);
    const [doc] = (await query.select("sessionId").limit(1).get()).docs;
    return doc ? (doc.get("sessionId") as string) : null;
  },
  summary: async (installId, sessionId) => {
    const [count, first] = await Promise.all([
      sessionSamples(installId, sessionId).count().get(),
      sessionSamples(installId, sessionId).orderBy("timeMs").select("timeMs").limit(1).get(),
    ]);
    return { startMs: (first.docs[0]?.get("timeMs") as number | undefined) ?? 0, samples: count.data().count };
  },
};

/**
 * The function is named `v1` and serves `POST /samples`, an upload, `POST /sessions/list`, which
 * lists an install's sessions, and `POST /sessions/delete`, which deletes one session. All need a
 * valid Firebase Auth ID token, and log only whether the App Check token was valid. At most 10 instances run and a request is cut off after 30 seconds,
 * so a flood of requests with valid tokens is bounded in cost. It has 512 MiB, not the default
 * 256 MiB, so that the largest upload it accepts, `MAX_BODY_BYTES` in `ingest.ts`, stays near
 * half of its memory, which leaves room for the extra Cloud Run uses beyond the emulator.
 */
export const v1 = onRequest({ maxInstances: 10, timeoutSeconds: 30, memory: "512MiB" }, async (req, res) => {
  const route = ({ "/samples": "upload", "/sessions/list": "list", "/sessions/delete": "delete" } as const)[req.path];
  if (!route) {
    res.status(404).json({ error: "not found" });
  } else if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "use POST" });
  } else {
    const [uid, appCheck] = await Promise.all([
      verifiedUid(req.header("Authorization")),
      appCheckVerdict(req.header("X-Firebase-AppCheck")),
    ]);
    logger.info(route, { appCheck });
    if (uid === undefined) {
      res.status(401).json({ error: "missing or invalid ID token" });
    } else if (route === "upload") {
      // The body parsers set rawBody, and they don't run for an empty body, whatever its type says.
      const { status, body } = await ingest(req.body, req.rawBody as Buffer | undefined, uid, firestoreStore, Date.now());
      res.status(status).json(body);
    } else if (route === "list") {
      const { status, body } = await listSessions(req.body, sessionListStore);
      res.status(status).json(body);
    } else {
      const response = await deleteSession(req.body, deletionStore);
      if (response.status === 204) res.status(204).end();
      else res.status(response.status).json(response.body);
    }
  }
});

// The hourly job's state. firestore.rules gives clients no access; only the functions, through
// the Admin SDK, use it. A private cell is stored as `{owner, h3, months}`: its session's key, its
// H3 cell and its state.
const hourlyRef = db.collection("aggregation").doc("session_cells");

function stored(doc: QueryDocumentSnapshot): Stored {
  const { expireAt, ...data } = doc.data();
  return { id: doc.id, expireAtMs: (expireAt as Timestamp).toMillis(), data };
}

/** The first [limit] documents of [query], in its order, as [stored], read with [readInChunks]. */
const readStored = (query: Query, limit: number) =>
  readInChunks<QueryDocumentSnapshot, Stored>(
    async (after, n) => (await (after ? query.startAfter(after) : query).limit(n).get()).docs,
    stored,
    limit,
  );

const hourlyState = (data: unknown) => (data as HourlyState | undefined) ?? { cursor: null, open: {} };

const aggregationStore: AggregationStore = {
  state: async () => hourlyState((await hourlyRef.get()).data()),
  samplesAfter: async (after, notBeforeMs, notAfterMs, limit) => {
    let query = signalLogs
      .where("expireAt", ">", Timestamp.fromMillis(notBeforeMs))
      .where("expireAt", "<=", Timestamp.fromMillis(notAfterMs))
      .orderBy("expireAt")
      .orderBy(FieldPath.documentId());
    if (after && after.expireAtMs > notBeforeMs) query = query.startAfter(Timestamp.fromMillis(after.expireAtMs), after.id);
    return readStored(query, limit);
  },
  sessionSamples: (sessionId, fromMs, notAfterMs, limit) =>
    readStored(
      signalLogs
        .where("sessionId", "==", sessionId)
        .where("expireAt", ">=", Timestamp.fromMillis(fromMs))
        .where("expireAt", "<=", Timestamp.fromMillis(notAfterMs))
        .orderBy("expireAt"),
      limit,
    ),
  commit: (expected, next, ids, update) =>
    db.runTransaction(async (tx) => {
      if (!isDeepStrictEqual(hourlyState((await tx.get(hourlyRef)).data()), expected)) return false;
      const refs = ids.map((id) => privateCells.doc(id));
      const keys = [...new Set(ids.map((id) => sessionCellOf(id).key))];
      const [docs, tombstones] = await Promise.all(
        [refs, keys.map((key) => deletedSessions.doc(key))].map((all) => (all.length > 0 ? tx.getAll(...all) : Promise.resolve([]))),
      );
      const deleted = new Set((tombstones ?? []).filter((doc) => doc.exists).map((doc) => doc.id));
      const cells: Record<string, CellState> = Object.fromEntries(
        (docs ?? []).map((doc) => [doc.id, (doc.get("months") as CellState | undefined) ?? {}]),
      );
      update(cells, deleted);
      for (const ref of refs) {
        const { key, h3 } = sessionCellOf(ref.id);
        if (!deleted.has(key)) tx.set(ref, { owner: key, h3, months: cells[ref.id] ?? {} });
      }
      tx.set(hourlyRef, next);
      return true;
    }),
};

/**
 * Adds the sessions that have ended to the private cells, every hour. A run starts no page later
 * than 5 minutes after it began, which leaves its last page 4 minutes before the timeout.
 */
export const aggregateHourly = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540 }, () => {
  const nowMs = Date.now();
  return runHourly(aggregationStore, nowMs, nowMs + 5 * 60_000);
});

// The daily job's state, the public cells keyed by resolution 11 H3 cell, and the public cells
// each run staged, keyed by `<runMs>_<h3>`. firestore.rules gives clients no access to any; the
// map is served from tiles made from the public cells, one file per tile at `tiles/<h3>.json` in
// the default bucket, and from the overview, one file per resolution at `overview/<resolution>.json`,
// which storage.rules lets anyone read.
const dailyRef = db.collection("aggregation").doc("daily");
const publicCells = db.collection("public_cells");
const stagedCells = db.collection("staged_public_cells");
const bucket = getStorage().bucket();

// The job rewrites every public file once a day. A cache keeps one for at most 5 minutes, so a
// deleted recording leaves the map at the next daily update, as the policy, the deletion page and
// the app say. The map keeps every file it fetched for as long as the page is open, so the short
// lifetime only costs a download when the page is opened again more than 5 minutes later.
const writePublicFile = (path: string, content: unknown) =>
  bucket.file(path).save(JSON.stringify(content), {
    resumable: false,
    metadata: { contentType: "application/json", cacheControl: "public, max-age=300" },
  });

const publishStore: PublishStore = {
  privateCells: async () =>
    (await privateCells.get()).docs.map((doc) => [doc.get("h3") as string, doc.get("months") as CellState]),
  state: async () => dailyState((await dailyRef.get()).data()),
  publicCells: async () => Object.fromEntries((await publicCells.get()).docs.map((doc) => [doc.id, doc.data() as PublicCell])),
  stage: async (runMs, cells) => {
    const batch = db.batch();
    for (const [h3, cell] of Object.entries(cells)) batch.set(stagedCells.doc(`${runMs}_${h3}`), { runMs, h3, cell });
    await batch.commit();
  },
  staged: async (runMs) =>
    Object.fromEntries(
      (await stagedCells.where("runMs", "==", runMs).get()).docs.map((doc) => [doc.get("h3") as string, doc.get("cell") as PublicCell | null]),
    ),
  commit: (expected, next) =>
    db.runTransaction(async (tx) => {
      if (!isDeepStrictEqual(dailyState((await tx.get(dailyRef)).data()), expected)) return false;
      tx.set(dailyRef, next);
      return true;
    }),
  writePublic: (runMs, cells) =>
    db.runTransaction(async (tx) => {
      if (dailyState((await tx.get(dailyRef)).data()).runMs !== runMs) return false;
      for (const [h3, cell] of Object.entries(cells)) {
        if (cell) tx.set(publicCells.doc(h3), cell);
        else tx.delete(publicCells.doc(h3));
      }
      return true;
    }),
  dropStaged: async (runMs) => {
    for (;;) {
      const { docs } = await stagedCells.where("runMs", "<=", runMs).limit(CELLS_PER_WRITE).get();
      if (docs.length === 0) return;
      const batch = db.batch();
      for (const doc of docs) batch.delete(doc.ref);
      await batch.commit();
    }
  },
  writeTile: (tile, cells) => writePublicFile(`tiles/${tile}.json`, cells),
  writeOverview: (resolution, cells) => writePublicFile(`overview/${resolution}.json`, cells),
};

/** Publishes the private cells into the public cells and the map tiles once a day, at 00:30 UTC. */
export const publishDaily = onSchedule({ schedule: "every day 00:30", timeZone: "Etc/UTC", timeoutSeconds: 540 }, () =>
  runDaily(publishStore, Date.now()),
);
