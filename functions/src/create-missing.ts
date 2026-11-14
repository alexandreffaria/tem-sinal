import type { DocumentReference, Transaction } from "firebase-admin/firestore";

/**
 * The longest a Firestore transaction lives: the server refuses its commit after this long, so
 * every write it makes is stored within this long after it began.
 */
export const TRANSACTION_LIFETIME_MS = 270_000;

/**
 * In the transaction [tx], creates each document that doesn't exist yet and leaves the others as
 * they are. Reads every document first, which begins the transaction; when [now] is past
 * [deadlineMs] after that read, it throws and creates nothing, so every write it makes is stored
 * before [deadlineMs] + [TRANSACTION_LIFETIME_MS].
 */
export async function createMissing<T>(
  tx: Pick<Transaction, "getAll" | "create">,
  docs: { ref: DocumentReference<T>; data: T }[],
  deadlineMs: number,
  now: () => number = Date.now,
): Promise<void> {
  const snapshots = await tx.getAll(...docs.map(({ ref }) => ref));
  if (now() > deadlineMs) throw new Error("the write deadline passed");
  docs.forEach(({ ref, data }, i) => {
    if (!snapshots[i]?.exists) tx.create(ref, data);
  });
}
