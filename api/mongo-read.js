import { BSON } from 'mongodb';

// Legacy array APIs must fail explicitly rather than truncate business data.
export const mongoReadBudget = Object.freeze({ rows: 10000, bytes: 8 * 1024 * 1024, maxTimeMS: 15000, batchSize: 25 });
export const mongoResultLimit = () => Object.assign(new Error('The result exceeds the supported read size. Narrow the search or use a paginated workflow.'), { code: 'DATABASE_RESULT_LIMIT', database: 'mongodb', status: 413, statusCode: 413 });
export function checkMongoReadBudget(rows, bytes) {
  if (rows > mongoReadBudget.rows || bytes > mongoReadBudget.bytes) throw mongoResultLimit();
}
export function mongoDocumentBytes(document) { return BSON.calculateObjectSize(document); }

export async function readMongoRows(collection, query, { sort, projection, session, limit } = {}) {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > mongoReadBudget.rows)) {
    throw Object.assign(new Error('Invalid bounded Mongo read page size'), { status: 400, code: 'DATABASE_PAGE_INVALID' });
  }
  // Transaction operations must inherit their session's CSOT deadline.
  // Driver 6.21 does not propagate a transaction's CSOT context into cursor
  // state: getMore then incorrectly receives maxTimeMS. Clone the existing
  // deadline (including its start time), rather than overriding timeoutMS or
  // starting another transaction budget. The real multi-batch regression must
  // accompany driver upgrades because timeoutContext is a driver-internal hook.
  const inheritedContext = session?.timeoutContext?.clone();
  const deadline = session ? { session, maxTimeMS: mongoReadBudget.maxTimeMS, ...(inheritedContext ? { timeoutContext: inheritedContext } : {}) } : { maxTimeMS: mongoReadBudget.maxTimeMS, timeoutMS: mongoReadBudget.maxTimeMS, timeoutMode: 'cursorLifetime' };
  let cursor = collection.find(query, deadline);
  if (sort) cursor = cursor.sort(sort);
  if (projection) cursor = cursor.project(projection);
  cursor = cursor.limit(limit ?? mongoReadBudget.rows + 1).batchSize(mongoReadBudget.batchSize);
  const rows = []; let bytes = 0, primaryError;
  try {
    for await (const row of cursor) {
      bytes += mongoDocumentBytes(row);
      checkMongoReadBudget(rows.length + 1, bytes);
      rows.push(row);
    }
    return rows;
  } catch (error) { primaryError = error; throw error; }
  finally {
    try { await cursor.close(); }
    catch (error) { if (!primaryError) throw error; }
  }
}

export async function readMongoOne(collection, query) {
  const row = await collection.findOne(query, { maxTimeMS: mongoReadBudget.maxTimeMS, timeoutMS: mongoReadBudget.maxTimeMS });
  if (row) checkMongoReadBudget(1, mongoDocumentBytes(row));
  return row;
}
