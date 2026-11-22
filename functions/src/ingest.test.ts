import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { HOURLY_LIMIT, MAX_BODY_BYTES, SAMPLE_LIFETIME_MS, type SampleStore, WRITE_DEADLINE_MS, ingest } from "./ingest.js";
import { INSTALL_ID, testSample } from "./test-sample.js";

/**
 * A [SampleStore] in memory, with create-only writes like Firestore's, that records each deadline
 * it is given and refuses to write when [nowMs] is past it.
 */
function fakeStore(nowMs = 0) {
  const stored = new Map<string, unknown>();
  const deadlines: number[] = [];
  const counts = new Map<string, number>();
  const store: SampleStore = {
    reserve: async (installId, uid, hourStartMs, count, limit) => {
      const keys = [`${installId}_${hourStartMs}`, `uid_${uid}_${hourStartMs}`];
      if (keys.some((key) => (counts.get(key) ?? 0) + count > limit)) return false;
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + count);
      return true;
    },
    create: async (samples, deadlineMs) => {
      deadlines.push(deadlineMs);
      if (nowMs > deadlineMs) throw new Error("the write deadline passed");
      for (const s of samples) {
        if (!stored.has(s.id)) stored.set(s.id, structuredClone(s));
      }
    },
  };
  return { store, stored, counts, deadlines };
}

const NOW = Date.UTC(2026, 0, 1, 10, 30);
const UID = "test-user";
/** The size of a body well under [MAX_BODY_BYTES]. */
const BYTES = 1_000;
const HOUR = `${INSTALL_ID}_${Date.UTC(2026, 0, 1, 10)}`;
const USER_HOUR = `uid_${UID}_${Date.UTC(2026, 0, 1, 10)}`;

test("the store is told to start writing within the write deadline", async () => {
  const fake = fakeStore();
  await ingest({ samples: [testSample()] }, BYTES, UID, fake.store, NOW);
  assert.deepEqual(fake.deadlines, [NOW + WRITE_DEADLINE_MS]);
});

test("a write attempted after the deadline is not made and the request fails", async () => {
  const fake = fakeStore(NOW + WRITE_DEADLINE_MS + 1);
  await assert.rejects(ingest({ samples: [testSample()] }, BYTES, UID, fake.store, NOW), /deadline/);
  assert.equal(fake.stored.size, 0);
});

test("a stored sample expires 90 days after the server received it", async () => {
  const fake = fakeStore();
  const sample = testSample();
  await ingest({ samples: [sample] }, BYTES, UID, fake.store, NOW);
  assert.equal(SAMPLE_LIFETIME_MS, 90 * 24 * 3_600_000);
  assert.deepEqual(fake.stored.get(sample.id), { ...sample, expireAt: new Date(NOW + SAMPLE_LIFETIME_MS) });
});

test("a valid batch sent twice is written once, keeps its first expiry and is accepted both times", async () => {
  const fake = fakeStore();
  const sample = testSample();
  const body = { samples: [sample, testSample()] };
  const first = await ingest(body, BYTES, UID, fake.store, NOW);
  const second = await ingest(body, BYTES, UID, fake.store, NOW + 3_600_000);
  assert.deepEqual(first, { status: 200, body: { accepted: 2, rejected: [] } });
  assert.deepEqual(second, first);
  assert.equal(fake.stored.size, 2);
  assert.deepEqual(fake.stored.get(sample.id), { ...sample, expireAt: new Date(NOW + SAMPLE_LIFETIME_MS) });
});

test("an invalid sample is reported and not written; the rest are", async () => {
  const fake = fakeStore();
  const bad = { ...testSample(), carrier: "VIVO" };
  const result = await ingest({ samples: [testSample(), bad] }, BYTES, UID, fake.store, NOW);
  assert.deepEqual(result, {
    status: 200,
    body: { accepted: 1, rejected: [{ index: 1, reasons: ["sample.carrier: unknown field"] }] },
  });
  assert.equal(fake.stored.has(bad.id), false);
  assert.equal(fake.stored.size, 1);
});

test("a batch over the cap is refused and nothing is written or counted", async () => {
  const fake = fakeStore();
  const result = await ingest({ samples: Array.from({ length: 501 }, testSample) }, BYTES, UID, fake.store, NOW);
  assert.equal(result.status, 400);
  assert.equal(fake.stored.size, 0);
  assert.equal(fake.counts.size, 0);
});

test("an install over its hourly limit is refused and nothing is written", async () => {
  const fake = fakeStore();
  fake.counts.set(HOUR, HOURLY_LIMIT - 1);
  const result = await ingest({ samples: [testSample(), testSample()] }, BYTES, UID, fake.store, NOW);
  assert.equal(result.status, 429);
  assert.equal(fake.stored.size, 0);
  assert.equal(fake.counts.get(HOUR), HOURLY_LIMIT - 1);
  const nextHour = await ingest({ samples: [testSample()] }, BYTES, UID, fake.store, NOW + 3_600_000);
  assert.equal(nextHour.status, 200);
});

test("a user rotating install ids is refused once over the hourly limit and nothing is written", async () => {
  const fake = fakeStore();
  fake.counts.set(USER_HOUR, HOURLY_LIMIT - 1);
  const fromInstall = (installId: string) => ({ ...testSample(), installId });
  const first = await ingest({ samples: [fromInstall(randomUUID())] }, BYTES, UID, fake.store, NOW);
  assert.equal(first.status, 200);
  const rotated = await ingest({ samples: [fromInstall(randomUUID())] }, BYTES, UID, fake.store, NOW);
  assert.equal(rotated.status, 429);
  assert.equal(fake.stored.size, 1);
  assert.equal(fake.counts.get(USER_HOUR), HOURLY_LIMIT);
  const otherUser = await ingest({ samples: [fromInstall(randomUUID())] }, BYTES, "other-user", fake.store, NOW);
  assert.equal(otherUser.status, 200);
});

test("a body over MAX_BODY_BYTES is refused whole with 413 and nothing is counted or stored", async () => {
  const fake = fakeStore();
  const response = await ingest({ samples: [testSample()] }, MAX_BODY_BYTES + 1, UID, fake.store, NOW);
  assert.equal(response.status, 413);
  assert.equal(fake.stored.size, 0);
  assert.equal(fake.counts.size, 0);
});

test("a body of exactly MAX_BODY_BYTES is taken", async () => {
  const fake = fakeStore();
  const response = await ingest({ samples: [testSample()] }, MAX_BODY_BYTES, UID, fake.store, NOW);
  assert.equal(response.status, 200);
  assert.equal(fake.stored.size, 1);
});
