import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { createAll } from "./bulk-create.js";
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
  create: (samples) => {
    const collection = db.collection("signal_logs");
    return createAll(
      db.bulkWriter(),
      samples.map((sample) => ({ ref: collection.doc(sample.id), data: sample })),
    );
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
