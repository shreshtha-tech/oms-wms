import { BSON } from 'mongodb';

export const restoreBudget = Object.freeze({ documents: 500, batchBytes: 8 * 1024 * 1024, documentBytes: 16 * 1024 * 1024 });
export function restoreDocumentBytes(document) {
  const bytes = BSON.calculateObjectSize(document);
  if (bytes > restoreBudget.documentBytes) throw new Error('Backup document exceeds the MongoDB 16 MiB document limit.');
  return bytes;
}
export async function insertRestoreBatches(collection, documents) {
  let batch = [], bytes = 0;
  for await (const document of documents) {
    const size = restoreDocumentBytes(document);
    if (batch.length && (batch.length >= restoreBudget.documents || bytes + size > restoreBudget.batchBytes)) {
      await collection.insertMany(batch, { ordered: true });
      batch = []; bytes = 0;
    }
    batch.push(document); bytes += size;
    // A valid single document can exceed the aggregate batch budget.
    if (bytes >= restoreBudget.batchBytes) {
      await collection.insertMany(batch, { ordered: true });
      batch = []; bytes = 0;
    }
  }
  if (batch.length) await collection.insertMany(batch, { ordered: true });
}
