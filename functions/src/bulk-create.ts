import type { BulkWriter, DocumentReference } from "firebase-admin/firestore";

/** gRPC ALREADY_EXISTS, which a create gets when the document exists. */
const ALREADY_EXISTS = 6;

/**
 * Creates each document with [writer], then closes it. A document that already exists is left as
 * it is. Any other write error rejects the returned promise, once every write has settled; every
 * write promise has its handler before the writer is awaited, so a failed write is never an
 * unhandled rejection.
 */
export async function createAll<T>(
  writer: Pick<BulkWriter, "create" | "close">,
  docs: { ref: DocumentReference<T>; data: T }[],
): Promise<void> {
  const writes = docs.map(({ ref, data }) =>
    writer.create(ref, data).catch((error: { code?: number }) => {
      if (error.code !== ALREADY_EXISTS) throw error;
    }),
  );
  const settled = await Promise.allSettled([...writes, writer.close()]);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
