import { increment, logEvent } from '../reliability/telemetry.js';

export function mongoCommitUncertain() {
  return Object.assign(new Error('The transaction commit outcome is unknown. Preserve the request identity and reconcile its result before retrying.'), { code: 'DATABASE_COMMIT_UNCERTAIN', database: 'mongodb', status: 503, statusCode: 503 });
}
export function isMongoCommitUncertain(error) {
  return (typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult') === true) || (Array.isArray(error?.errorLabels) && error.errorLabels.includes('UnknownTransactionCommitResult'));
}

export async function withMongoSession(client, operation, options = {}) {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => operation(session), { ...options, timeoutMS: 60000, maxCommitTimeMS: 15000 });
  } catch (error) {
    if (isMongoCommitUncertain(error)) throw mongoCommitUncertain();
    throw error;
  } finally {
    try { await session.endSession(); }
    catch {
      // Cleanup is not authority to change an already committed business result.
      increment('mongodb_session_cleanup_failures_total');
      logEvent('mongodb_session_cleanup_failed', { database: 'mongodb', code: 'SESSION_CLEANUP_FAILED' });
    }
  }
}
