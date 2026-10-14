import assert from 'node:assert/strict';
import pg from 'pg';
import { releaseStockMappingLock } from '../inventory/stock-lock-cleanup.js';
export async function verifyStockLockCleanupPostgres(config) {
  const pool = new pg.Pool({ ...config, max: 1 });
  const control = new pg.Client(config);
  pool.on('error', () => {});
  let held;
  try {
    await control.connect();
    held = await pool.connect();
    held.on('error', () => {});
    const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const lockKey = 'owned-stock-lock-loss';
    await held.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
    await held.query('INSERT INTO integrity_fixture VALUES(2,99)');
    async function committedOperation() {
      try {
        assert.equal((await control.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated, true);
        return 'committed-result';
      } finally {
        const client = held; held = null;
        await releaseStockMappingLock(client, lockKey, { locked: true });
      }
    }
    assert.equal(await committedOperation(), 'committed-result');
    const fresh = await pool.connect();
    try {
      assert.notEqual((await fresh.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid);
      assert.equal((await fresh.query('SELECT value FROM integrity_fixture WHERE id=2')).rows[0].value, 99);
      assert.equal((await fresh.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lockKey])).rows[0].locked, true);
      assert.equal((await fresh.query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked', [lockKey])).rows[0].unlocked, true);
    } finally { fresh.release(); }
  } finally {
    held?.release(true);
    await control.end(); await pool.end();
  }
}
