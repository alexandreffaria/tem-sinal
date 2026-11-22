/**
 * How many documents one query of [readInChunks] fetches. A query snapshot takes about 60 KB of
 * memory a sample document while it is alive, more than ten times the sample as a plain object.
 */
export const CHUNK_SIZE = 500;

/**
 * The first [limit] documents of a query, in its order, each turned into a result with [convert].
 * [fetch] returns up to `n` documents of the query after the document [after], or from its first
 * when [after] is null. Fetches [CHUNK_SIZE] documents at a time and converts each chunk before
 * fetching the next, so only one chunk of documents is held at a time.
 */
export async function readInChunks<D, T>(
  fetch: (after: D | null, n: number) => Promise<D[]>,
  convert: (doc: D) => T,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let after: D | null = null;
  while (results.length < limit) {
    const n = Math.min(CHUNK_SIZE, limit - results.length);
    const docs = await fetch(after, n);
    results.push(...docs.map(convert));
    after = docs.at(-1) ?? null;
    if (docs.length < n) break;
  }
  return results;
}
