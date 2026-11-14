import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { createMissing } from "./create-missing.js";

const DEADLINE = 1_800_000_000_000;

/** A transaction over documents with the ids in [existing]; [created] lists the ids it creates. */
function fakeTransaction(existing: string[]) {
  const created: string[] = [];
  const tx = {
    getAll: async (...refs: { id: string }[]) => refs.map(({ id }) => ({ exists: existing.includes(id) })),
    create: (ref: { id: string }) => {
      created.push(ref.id);
      return tx;
    },
  };
  return { tx: tx as unknown as Pick<Transaction, "getAll" | "create">, created };
}

function docs(...ids: string[]) {
  return ids.map((id) => ({ ref: { id } as DocumentReference<unknown>, data: {} }));
}

test("documents that don't exist are created and the others are left as they are", async () => {
  const { tx, created } = fakeTransaction(["b"]);
  await createMissing(tx, docs("a", "b", "c"), DEADLINE, () => DEADLINE);
  assert.deepEqual(created, ["a", "c"]);
});

test("a write attempted after the deadline is not made and the call rejects", async () => {
  const { tx, created } = fakeTransaction([]);
  await assert.rejects(createMissing(tx, docs("a", "b"), DEADLINE, () => DEADLINE + 1), /deadline/);
  assert.deepEqual(created, []);
});
