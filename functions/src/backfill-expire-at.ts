// A one-off admin script: gives each `signal_logs` document that has no `expireAt` one,
// [SAMPLE_LIFETIME_MS] after the document's create time, so the TTL policy deletes it 90 days
// after it arrived; a document older than that is deleted by the policy within about a day.
// It uses the Firestore REST API with a caller's OAuth access token and prints counts only.
//
//   ACCESS_TOKEN="$(gcloud auth print-access-token)" node lib/backfill-expire-at.js          # counts
//   ACCESS_TOKEN="$(gcloud auth print-access-token)" node lib/backfill-expire-at.js --write  # sets
import { pathToFileURL } from "node:url";
import { SAMPLE_LIFETIME_MS } from "./ingest.js";

const DOCUMENTS = "https://firestore.googleapis.com/v1/projects/cellsignalmapper-a9da1/databases/(default)/documents";

/** The most writes one Firestore commit takes. */
const COMMIT_LIMIT = 500;

/** A document as the REST API lists it with the field mask `expireAt`. */
export interface ListedDocument {
  name: string;
  createTime: string;
  updateTime: string;
  fields?: { expireAt?: unknown };
}

/**
 * A REST commit write for each document in [docs] without `expireAt`, setting only `expireAt` to
 * [SAMPLE_LIFETIME_MS] after its create time. Each write applies only while the document is
 * unchanged since it was listed.
 */
export function expireAtWrites(docs: ListedDocument[]) {
  return docs
    .filter((doc) => doc.fields?.expireAt === undefined)
    .map((doc) => ({
      update: {
        name: doc.name,
        fields: { expireAt: { timestampValue: new Date(Date.parse(doc.createTime) + SAMPLE_LIFETIME_MS).toISOString() } },
      },
      updateMask: { fieldPaths: ["expireAt"] },
      currentDocument: { updateTime: doc.updateTime },
    }));
}

async function call(token: string, url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Firestore answered ${response.status}`);
  return response.json();
}

async function main(token: string, write: boolean): Promise<void> {
  const writes = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ pageSize: "1000", "mask.fieldPaths": "expireAt", ...(pageToken ? { pageToken } : {}) });
    const page = (await call(token, `${DOCUMENTS}/signal_logs?${query}`)) as { documents?: ListedDocument[]; nextPageToken?: string };
    writes.push(...expireAtWrites(page.documents ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  const now = new Date().toISOString();
  const expired = writes.filter((w) => w.update.fields.expireAt.timestampValue <= now).length;
  console.log(`without expireAt: ${writes.length}, of which more than 90 days old: ${expired}`);
  if (!write) return;
  let updated = 0;
  for (let i = 0; i < writes.length; i += COMMIT_LIMIT) {
    await call(token, `${DOCUMENTS}:commit`, { writes: writes.slice(i, i + COMMIT_LIMIT) });
    updated += Math.min(COMMIT_LIMIT, writes.length - i);
  }
  console.log(`updated: ${updated}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.ACCESS_TOKEN;
  if (!token) throw new Error("set ACCESS_TOKEN to an OAuth access token for the project");
  await main(token, process.argv.includes("--write"));
}
