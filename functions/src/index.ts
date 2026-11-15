import { isDeepStrictEqual } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, type QueryDocumentSnapshot, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { CellState, PublicCell } from "./aggregate.js";
import { createMissing } from "./create-missing.js";
import { type DailyState, type PublishStore, runDaily } from "./daily.js";
import { type AggregationStore, type HourlyState, type Stored, runHourly } from "./hourly.js";
import { type SampleStore, ingest } from "./ingest.js";

// Every function runs as this account, which holds only what they use: Firestore through the
// Admin SDK, object writes in the default bucket, and log writes. Verifying App Check and Auth
// tokens fetches public keys and needs no role. The scheduled functions' Cloud Scheduler jobs
// call them with an OIDC token for this account, which is their only invoker.
setGlobalOptions({ serviceAccount: "functions-runtime@cellsignalmapper-a9da1.iam.gserviceaccount.com" });

initializeApp();
const db = getFirestore();

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
    const collection = db.collection("signal_logs");
    const docs = samples.map((sample) => ({ ref: collection.doc(sample.id), data: sample }));
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

/**
 * `POST /v1/samples`: the function is named `v1` and serves the path `/samples`. At most 10
 * instances run and a request is cut off after 30 seconds, so a flood of requests with valid
 * tokens is bounded in cost.
 */
export const v1 = onRequest({ maxInstances: 10, timeoutSeconds: 30 }, async (req, res) => {
  if (req.path !== "/samples") {
    res.status(404).json({ error: "not found" });
  } else if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "use POST" });
  } else {
    const [uid, appCheck] = await Promise.all([
      verifiedUid(req.header("Authorization")),
      appCheckVerdict(req.header("X-Firebase-AppCheck")),
    ]);
    logger.info("upload", { appCheck });
    if (uid === undefined) {
      res.status(401).json({ error: "missing or invalid ID token" });
    } else {
      const { status, body } = await ingest(req.body, uid, firestoreStore, Date.now());
      res.status(status).json(body);
    }
  }
});

// The hourly job's state and the private cells, keyed by resolution 12 H3 cell. firestore.rules
// gives clients no access to either; only the functions, through the Admin SDK, use them.
const hourlyRef = db.collection("aggregation").doc("hourly");
const privateCells = db.collection("private_cells");
const signalLogs = db.collection("signal_logs");

function stored(doc: QueryDocumentSnapshot): Stored {
  const { expireAt, ...data } = doc.data();
  return { id: doc.id, expireAtMs: (expireAt as Timestamp).toMillis(), data };
}

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
    return (await query.limit(limit).get()).docs.map(stored);
  },
  sessionSamples: async (sessionId, fromMs, notAfterMs, limit) =>
    (
      await signalLogs
        .where("sessionId", "==", sessionId)
        .where("expireAt", ">=", Timestamp.fromMillis(fromMs))
        .where("expireAt", "<=", Timestamp.fromMillis(notAfterMs))
        .orderBy("expireAt")
        .limit(limit)
        .get()
    ).docs.map(stored),
  commit: (expected, next, ids, update) =>
    db.runTransaction(async (tx) => {
      if (!isDeepStrictEqual(hourlyState((await tx.get(hourlyRef)).data()), expected)) return false;
      const refs = ids.map((id) => privateCells.doc(id));
      const docs = refs.length > 0 ? await tx.getAll(...refs) : [];
      const cells: Record<string, CellState> = Object.fromEntries(docs.map((doc) => [doc.id, (doc.data() as CellState | undefined) ?? {}]));
      update(cells);
      for (const ref of refs) tx.set(ref, cells[ref.id] ?? {});
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

// The daily job's state and the public cells, keyed by resolution 11 H3 cell. firestore.rules
// gives clients no access to either; the map is served from tiles made from the public cells, one
// file per tile at `tiles/<h3>.json` in the default bucket, which storage.rules lets anyone read.
const dailyRef = db.collection("aggregation").doc("daily");
const publicCells = db.collection("public_cells");
const bucket = getStorage().bucket();

const dailyState = (data: unknown) => (data as DailyState | undefined) ?? { held: [], lastBatch: null, runMs: null };

const publishStore: PublishStore = {
  privateCells: async () => Object.fromEntries((await privateCells.get()).docs.map((doc) => [doc.id, doc.data() as CellState])),
  state: async () => dailyState((await dailyRef.get()).data()),
  publicCells: async () => Object.fromEntries((await publicCells.get()).docs.map((doc) => [doc.id, doc.data() as PublicCell])),
  commit: (expected, next, changed) =>
    db.runTransaction(async (tx) => {
      if (!isDeepStrictEqual(dailyState((await tx.get(dailyRef)).data()), expected)) return false;
      for (const [h3, cell] of Object.entries(changed)) tx.set(publicCells.doc(h3), cell);
      tx.set(dailyRef, next);
      return true;
    }),
  // The job rewrites every tile once a day, so a cache may keep a tile for up to a day.
  writeTile: (tile, cells) =>
    bucket.file(`tiles/${tile}.json`).save(JSON.stringify(cells), {
      resumable: false,
      metadata: { contentType: "application/json", cacheControl: "public, max-age=86400" },
    }),
};

/** Publishes the private cells into the public cells and the map tiles once a day, at 00:30 UTC. */
export const publishDaily = onSchedule({ schedule: "every day 00:30", timeZone: "Etc/UTC", timeoutSeconds: 540 }, () =>
  runDaily(publishStore, Date.now()),
);
