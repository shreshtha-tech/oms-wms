import { increment, logEvent } from './telemetry.js';
import { isPostgresConnectivityError } from './postgres-connection.js';
function cleanupFailure(kind) {
  try { increment('postgres_cleanup_failure_total', { operation: kind }); } catch {}
  try { logEvent('postgres_cleanup_failed', { database: 'postgresql', operation: kind, code: 'CLEANUP_FAILED' }); } catch {}
}
export function releasePostgresClient(client, discard = false) {
  try { client.release(discard); }
  catch { cleanupFailure('release'); }
}
export async function runPostgresTransaction(pool, operation) {
  const client = await pool.connect();
  let discard = false;
  let committing = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    committing = true;
    await client.query('COMMIT');
    committing = false;
    return result;
  } catch (error) {
    const uncertain = committing && (['DATABASE_UNAVAILABLE', 'DATABASE_TIMEOUT', '57014'].includes(error?.code) || isPostgresConnectivityError(error));
    if (uncertain) discard = true;
    try { await client.query('ROLLBACK'); }
    catch { discard = true; cleanupFailure('rollback'); }
    if (uncertain) throw Object.assign(new Error('The transaction commit outcome is unknown. Preserve the request identity and reconcile its result before retrying.'), { code: 'DATABASE_COMMIT_UNCERTAIN', database: 'postgresql', status: 503, statusCode: 503 });
    throw error;
  } finally { releasePostgresClient(client, discard); }
}
