import { isDeepStrictEqual } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, type QueryDocumentSnapshot, Timestamp, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { CellState } from "./aggregate.js";
import { createMissing } from "./create-missing.js";
import { type AggregationStore, type HourlyState, type Stored, runHourly } from "./hourly.js";
import { type SampleStore, ingest } from "./ingest.js";

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
 * The Firebase Auth uid of a request that carries a valid App Check token and a valid Firebase
 * Auth ID token, or undefined.
 */
async function verifiedUid(appCheckToken: string | undefined, authorization: string | undefined): Promise<string | undefined> {
  const idToken = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!appCheckToken || !idToken) return undefined;
  try {
    const [, decoded] = await Promise.all([getAppCheck().verifyToken(appCheckToken), getAuth().verifyIdToken(idToken)]);
    return decoded.uid;
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
    const uid = await verifiedUid(req.header("X-Firebase-AppCheck"), req.header("Authorization"));
    if (uid === undefined) {
      res.status(401).json({ error: "missing or invalid App Check or ID token" });
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
  sessionSamples: async (sessionId, fromMs) =>
    (await signalLogs.where("sessionId", "==", sessionId).where("expireAt", ">=", Timestamp.fromMillis(fromMs)).get()).docs.map(stored),
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

/** Adds the sessions that have ended to the private cells, every hour. */
export const aggregateHourly = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540 }, () =>
  runHourly(aggregationStore, Date.now()),
);
