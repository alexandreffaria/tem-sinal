import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_SIZE, readInChunks } from "./read-chunks.js";

/** A query over the numbers 0 to [size] - 1; [fetched] lists the size of each fetch it answered. */
function fakeQuery(size: number) {
  const fetched: number[] = [];
  const fetch = async (after: number | null, n: number) => {
    const from = after === null ? 0 : after + 1;
    const docs = Array.from({ length: Math.max(0, Math.min(n, size - from)) }, (_, i) => from + i);
    fetched.push(docs.length);
    return docs;
  };
  return { fetch, fetched };
}

test("the first limit documents are read in order, at most CHUNK_SIZE a fetch", async () => {
  const { fetch, fetched } = fakeQuery(3 * CHUNK_SIZE);
  const read = await readInChunks(fetch, (doc) => `doc ${doc}`, 2 * CHUNK_SIZE + 7);
  assert.deepEqual(read, Array.from({ length: 2 * CHUNK_SIZE + 7 }, (_, i) => `doc ${i}`));
  assert.deepEqual(fetched, [CHUNK_SIZE, CHUNK_SIZE, 7]);
});

test("a query with fewer documents than the limit is read whole and then stops", async () => {
  const { fetch, fetched } = fakeQuery(CHUNK_SIZE + 3);
  const read = await readInChunks(fetch, (doc) => doc, 10 * CHUNK_SIZE);
  assert.deepEqual(read, Array.from({ length: CHUNK_SIZE + 3 }, (_, i) => i));
  assert.deepEqual(fetched, [CHUNK_SIZE, 3]);
});

test("a query whose size is a multiple of CHUNK_SIZE ends with one empty fetch", async () => {
  const { fetch, fetched } = fakeQuery(2 * CHUNK_SIZE);
  assert.equal((await readInChunks(fetch, (doc) => doc, 10 * CHUNK_SIZE)).length, 2 * CHUNK_SIZE);
  assert.deepEqual(fetched, [CHUNK_SIZE, CHUNK_SIZE, 0]);
});

test("each chunk is converted before the next is fetched", async () => {
  const events: string[] = [];
  const { fetch } = fakeQuery(CHUNK_SIZE + 1);
  await readInChunks(
    async (after: number | null, n: number) => {
      events.push("fetch");
      return fetch(after, n);
    },
    (doc) => {
      if (doc % CHUNK_SIZE === 0) events.push("convert");
      return doc;
    },
    10 * CHUNK_SIZE,
  );
  assert.deepEqual(events, ["fetch", "convert", "fetch", "convert"]);
});
