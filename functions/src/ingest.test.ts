import assert from "node:assert/strict";
import { test } from "node:test";
import { HOURLY_LIMIT, type SampleStore, ingest } from "./ingest.js";
import { INSTALL_ID, testSample } from "./test-sample.js";

/** A [SampleStore] in memory, with create-only writes like Firestore's. */
function fakeStore() {
  const stored = new Map<string, unknown>();
  const counts = new Map<string, number>();
  const store: SampleStore = {
    reserve: async (installId, hourStartMs, count, limit) => {
      const key = `${installId}_${hourStartMs}`;
      const used = counts.get(key) ?? 0;
      if (used + count > limit) return false;
      counts.set(key, used + count);
      return true;
    },
    create: async (samples) => {
      for (const s of samples) {
        if (!stored.has(s.id)) stored.set(s.id, structuredClone(s));
      }
    },
  };
  return { store, stored, counts };
}

const NOW = Date.UTC(2026, 0, 1, 10, 30);
const HOUR = `${INSTALL_ID}_${Date.UTC(2026, 0, 1, 10)}`;

test("a valid batch sent twice is written once and accepted both times", async () => {
  const fake = fakeStore();
  const sample = testSample();
  const body = { samples: [sample, testSample()] };
  const first = await ingest(body, fake.store, NOW);
  const second = await ingest(body, fake.store, NOW);
  assert.deepEqual(first, { status: 200, body: { accepted: 2, rejected: [] } });
  assert.deepEqual(second, first);
  assert.equal(fake.stored.size, 2);
  assert.deepEqual(fake.stored.get(sample.id), sample);
});

test("an invalid sample is reported and not written; the rest are", async () => {
  const fake = fakeStore();
  const bad = { ...testSample(), carrier: "VIVO" };
  const result = await ingest({ samples: [testSample(), bad] }, fake.store, NOW);
  assert.deepEqual(result, {
    status: 200,
    body: { accepted: 1, rejected: [{ index: 1, reasons: ["sample.carrier: unknown field"] }] },
  });
  assert.equal(fake.stored.has(bad.id), false);
  assert.equal(fake.stored.size, 1);
});

test("a batch over the cap is refused and nothing is written or counted", async () => {
  const fake = fakeStore();
  const result = await ingest({ samples: Array.from({ length: 501 }, testSample) }, fake.store, NOW);
  assert.equal(result.status, 400);
  assert.equal(fake.stored.size, 0);
  assert.equal(fake.counts.size, 0);
});

test("an install over its hourly limit is refused and nothing is written", async () => {
  const fake = fakeStore();
  fake.counts.set(HOUR, HOURLY_LIMIT - 1);
  const result = await ingest({ samples: [testSample(), testSample()] }, fake.store, NOW);
  assert.equal(result.status, 429);
  assert.equal(fake.stored.size, 0);
  assert.equal(fake.counts.get(HOUR), HOURLY_LIMIT - 1);
  const nextHour = await ingest({ samples: [testSample()] }, fake.store, NOW + 3_600_000);
  assert.equal(nextHour.status, 200);
});
