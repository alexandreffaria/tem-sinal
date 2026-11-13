import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { BulkWriter, DocumentReference } from "firebase-admin/firestore";
import { createAll } from "./bulk-create.js";

/**
 * A writer whose create fails with the gRPC code given for a document id, and whose close, like
 * BulkWriter's, resolves only after the event loop has run, whatever the writes did.
 */
function fakeWriter(codes: Record<string, number>): Pick<BulkWriter, "create" | "close"> {
  const writer = {
    create: (ref: { id: string }) => {
      const code = codes[ref.id];
      if (code === undefined) return Promise.resolve();
      return Promise.reject(Object.assign(new Error("write failed"), { code }));
    },
    close: () => setImmediate(),
  };
  return writer as unknown as Pick<BulkWriter, "create" | "close">;
}

function docs(...ids: string[]) {
  return ids.map((id) => ({ ref: { id } as DocumentReference<unknown>, data: {} }));
}

/** Runs [body] and returns the rejections that had no handler while it ran. */
async function unhandledDuring(body: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await body();
    await setImmediate();
  } finally {
    process.off("unhandledRejection", listener);
  }
  return unhandled;
}

test("a document that already exists is skipped and the rest succeed", async () => {
  await createAll(fakeWriter({ b: 6 }), docs("a", "b", "c"));
});

test("any other write error rejects without an unhandled rejection", async () => {
  const unhandled = await unhandledDuring(() =>
    assert.rejects(createAll(fakeWriter({ b: 6, c: 13 }), docs("a", "b", "c")), { code: 13 }),
  );
  assert.deepEqual(unhandled, []);
});
