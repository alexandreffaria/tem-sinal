import assert from "node:assert/strict";
import { test } from "node:test";
import { expireAtWrites } from "./backfill-expire-at.js";
import { SAMPLE_LIFETIME_MS } from "./ingest.js";

const name = (id: string) => `projects/p/databases/(default)/documents/signal_logs/${id}`;

test("sets expireAt to the lifetime after the create time on documents without one", () => {
  const createTime = "2026-03-01T12:00:00.000Z";
  const updateTime = "2026-03-02T08:00:00.000Z";
  assert.deepEqual(expireAtWrites([{ name: name("a"), createTime, updateTime }]), [
    {
      update: { name: name("a"), fields: { expireAt: { timestampValue: new Date(Date.parse(createTime) + SAMPLE_LIFETIME_MS).toISOString() } } },
      updateMask: { fieldPaths: ["expireAt"] },
      currentDocument: { updateTime },
    },
  ]);
});

test("leaves documents that have an expireAt", () => {
  const doc = { name: name("b"), createTime: "2026-03-01T12:00:00Z", updateTime: "2026-03-01T12:00:00Z" };
  assert.deepEqual(expireAtWrites([{ ...doc, fields: { expireAt: { timestampValue: "2026-05-30T12:00:00Z" } } }]), []);
  assert.equal(expireAtWrites([doc, { ...doc, fields: {} }]).length, 2);
});
