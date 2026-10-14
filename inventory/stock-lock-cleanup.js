import { logEvent, increment } from '../reliability/telemetry.js';
function reportCleanupFailure() {
  try { increment('stock_lock_cleanup_failure_total'); } catch {}
  try { logEvent('stock_lock_release_failed', { code: 'LOCK_CLEANUP_FAILED' }); } catch {}
}
export async function releaseStockMappingLock(client, lockKey, { locked, primaryError } = {}) {
  let discard = primaryError?.code === 'DATABASE_UNAVAILABLE';
  try {
    if (locked) {
      const result = await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      if (result.rows[0]?.pg_advisory_unlock !== true) throw new Error('Lock release was not confirmed');
    }
  } catch {
    discard = true;
    reportCleanupFailure();
  }
  try { client.release(discard); }
  catch { reportCleanupFailure(); }
}
