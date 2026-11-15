import type { DocumentData, DocumentReference, Transaction } from "firebase-admin/firestore";

/**
 * The longest a Firestore transaction lives: the server refuses its commit after this long, so
 * every write it makes is stored within this long after it began.
 */
export const TRANSACTION_LIFETIME_MS = 270_000;

/**
 * In the transaction [tx], creates each document that doesn't exist yet and whose [unless]
 * document doesn't exist either, and leaves the others as they are. Reads every document and
 * every [unless] document first, which begins the transaction; when [now] is past [deadlineMs]
 * after that read, it throws and creates nothing, so every write it makes is stored before
 * [deadlineMs] + [TRANSACTION_LIFETIME_MS].
 */
export async function createMissing(
  tx: Pick<Transaction, "getAll" | "create">,
  docs: { ref: DocumentReference; data: DocumentData; unless: DocumentReference }[],
  deadlineMs: number,
  now: () => number = Date.now,
): Promise<void> {
  const unless = [...new Map(docs.map((doc) => [doc.unless.path, doc.unless])).values()];
  const snapshots = await tx.getAll(...docs.map(({ ref }) => ref), ...unless);
  if (now() > deadlineMs) throw new Error("the write deadline passed");
  const vetoed = new Set(unless.filter((_, i) => snapshots[docs.length + i]?.exists).map((ref) => ref.path));
  docs.forEach(({ ref, data, unless }, i) => {
    if (!snapshots[i]?.exists && !vetoed.has(unless.path)) tx.create(ref, data);
  });
}
