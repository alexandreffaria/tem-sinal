import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { type SampleStore, ingest } from "./ingest.js";

initializeApp();
const db = getFirestore();

/** gRPC ALREADY_EXISTS, which a create gets when the document exists. */
const ALREADY_EXISTS = 6;

/** How long a counter document is kept after its hour starts; a TTL policy on `expireAt` deletes it. */
const COUNTER_LIFETIME_MS = 2 * 3_600_000;

const firestoreStore: SampleStore = {
  reserve: (installId, hourStartMs, count, limit) =>
    db.runTransaction(async (tx) => {
      const ref = db.collection("upload_counts").doc(`${installId}_${hourStartMs}`);
      const used = ((await tx.get(ref)).get("count") as number | undefined) ?? 0;
      if (used + count > limit) return false;
      tx.set(ref, {
        installId,
        hourStartMs,
        count: used + count,
        expireAt: new Date(hourStartMs + COUNTER_LIFETIME_MS),
      });
      return true;
    }),
  create: async (samples) => {
    const writer = db.bulkWriter();
    const collection = db.collection("signal_logs");
    const writes = samples.map((sample) =>
      writer.create(collection.doc(sample.id), sample).catch((error: { code?: number }) => {
        if (error.code !== ALREADY_EXISTS) throw error;
      }),
    );
    await writer.close();
    await Promise.all(writes);
  },
};

/** True when the request carries a valid App Check token and a valid Firebase Auth ID token. */
async function verified(appCheckToken: string | undefined, authorization: string | undefined): Promise<boolean> {
  const idToken = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!appCheckToken || !idToken) return false;
  try {
    await Promise.all([getAppCheck().verifyToken(appCheckToken), getAuth().verifyIdToken(idToken)]);
    return true;
  } catch {
    return false;
  }
}

/** `POST /v1/samples`: the function is named `v1` and serves the path `/samples`. */
export const v1 = onRequest(async (req, res) => {
  if (req.path !== "/samples") {
    res.status(404).json({ error: "not found" });
  } else if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "use POST" });
  } else if (!(await verified(req.header("X-Firebase-AppCheck"), req.header("Authorization")))) {
    res.status(401).json({ error: "missing or invalid App Check or ID token" });
  } else {
    const { status, body } = await ingest(req.body, firestoreStore, Date.now());
    res.status(status).json(body);
  }
});
