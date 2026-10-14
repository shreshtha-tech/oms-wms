import { BSON } from 'mongodb';
import { readMongoRows } from './mongo-read.js';
import { withMongoSession } from './mongo-session.js';

export const mongoMutationBudget = Object.freeze({ ids: 1000, fieldBytes: 1024 * 1024 });
export function validateMongoUpdate(ids, fields) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (list.length > mongoMutationBudget.ids) throw Object.assign(new Error('Use a bounded batch of at most 1,000 record IDs.'), { code: 'DATABASE_MUTATION_LIMIT', status: 413, statusCode: 413 });
  if (list.some(id => !Number.isSafeInteger(id) || id < 1) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw Object.assign(new Error('Positive integer record IDs and an update object are required.'), { code: 'DATABASE_MUTATION_INVALID', status: 400, statusCode: 400 });
  if (BSON.calculateObjectSize(fields) > mongoMutationBudget.fieldBytes) throw Object.assign(new Error('Update fields exceed the supported 1 MiB batch size.'), { code: 'DATABASE_MUTATION_LIMIT', status: 413, statusCode: 413 });
  const unique = [...new Set(list)];
  if (Object.hasOwn(fields, 'id') && (unique.length !== 1 || fields.id !== unique[0])) throw Object.assign(new Error('Record identity cannot be changed by an update.'), { code: 'DATABASE_MUTATION_INVALID', status: 400, statusCode: 400 });
  return unique;
}

export async function updateMongoDocuments(collection, ids, fields, client) {
  const list = validateMongoUpdate(ids, fields);
  if (!list.length) return [];
  if (list.length === 1) {
    // The returned document is the actual atomic update result, not a later read.
    const row = await collection.findOneAndUpdate({ id: list[0] }, { $set: fields }, { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 });
    return row ? [row] : [];
  }
  return withMongoSession(client, async session => {
    await collection.updateMany({ id: { $in: list } }, { $set: fields }, { session });
    // Result-budget or readback failure rejects the transaction before commit.
    return readMongoRows(collection, { id: { $in: list } }, { session });
  });
}

export async function updateMongoQuery(collection, query, fields, client) {
  validateMongoUpdate([], fields);
  return withMongoSession(client, async session => {
    // Count the actual matched write set, inside the transaction. A preflight
    // count outside it can race with inserts and cannot prevent partial writes.
    const result = await collection.updateMany(query, { $set: fields }, { session });
    if (result.matchedCount > mongoMutationBudget.ids) {
      throw Object.assign(new Error('Query update exceeds the supported 1,000-record batch.'), { code: 'DATABASE_MUTATION_LIMIT', status: 413, statusCode: 413 });
    }
  });
}
