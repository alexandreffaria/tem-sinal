import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { createMissing } from "./create-missing.js";

const DEADLINE = 1_800_000_000_000;

/** A transaction over documents with the paths in [existing]; [created] lists the paths it creates. */
function fakeTransaction(existing: string[]) {
  const created: string[] = [];
  const tx = {
    getAll: async (...refs: { path: string }[]) => refs.map(({ path }) => ({ exists: existing.includes(path) })),
    create: (ref: { path: string }) => {
      created.push(ref.path);
      return tx;
    },
  };
  return { tx: tx as unknown as Pick<Transaction, "getAll" | "create">, created };
}

const ref = (path: string) => ({ path }) as unknown as DocumentReference;

/** Documents at [paths], each to be created unless `deleted/<unless>` exists. */
function docs(unless: string, ...paths: string[]) {
  return paths.map((path) => ({ ref: ref(path), data: {}, unless: ref(`deleted/${unless}`) }));
}

test("documents that don't exist are created and the others are left as they are", async () => {
  const { tx, created } = fakeTransaction(["b"]);
  await createMissing(tx, docs("x", "a", "b", "c"), DEADLINE, () => DEADLINE);
  assert.deepEqual(created, ["a", "c"]);
});

test("a document whose unless document exists is not created; the others are", async () => {
  const { tx, created } = fakeTransaction(["deleted/x"]);
  await createMissing(tx, [...docs("x", "a", "b"), ...docs("y", "c")], DEADLINE, () => DEADLINE);
  assert.deepEqual(created, ["c"]);
});

test("a write attempted after the deadline is not made and the call rejects", async () => {
  const { tx, created } = fakeTransaction([]);
  await assert.rejects(createMissing(tx, docs("x", "a", "b"), DEADLINE, () => DEADLINE + 1), /deadline/);
  assert.deepEqual(created, []);
});
