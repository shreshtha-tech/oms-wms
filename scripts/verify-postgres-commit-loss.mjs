import assert from 'node:assert/strict';
import net from 'node:net';
import pg from 'pg';
import { runPostgresTransaction } from '../reliability/postgres-transaction.js';

export async function withPostgresCommitLoss(config, operation) {
  let armed = false, sawCommit = false;
  const sockets = new Set();
  const proxy = net.createServer(downstream => {
    const upstream = net.connect({ host: config.host, port: config.port });
    sockets.add(downstream); sockets.add(upstream);
    let buffered = Buffer.alloc(0);
    downstream.on('data', bytes => upstream.write(bytes));
    upstream.on('data', bytes => {
      if (!armed) { downstream.write(bytes); return; }
      // PostgreSQL response messages: one-byte type, four-byte length,
      // then payload. Suppress all commit replies once the test is armed.
      buffered = Buffer.concat([buffered, bytes]);
      while (buffered.length >= 5) {
        const length = buffered.readInt32BE(1);
        if (length < 4 || length > 1024 * 1024) { downstream.destroy(); upstream.destroy(); return; }
        if (buffered.length < length + 1) return;
        const frame = buffered.subarray(0, length + 1);
        buffered = buffered.subarray(length + 1);
        if (frame[0] === 67 && frame.subarray(5).toString() === 'COMMIT\0') {
          sawCommit = true;
          downstream.destroy(); upstream.destroy();
          return;
        }
      }
    });
    for (const socket of [downstream, upstream]) {
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); downstream.destroy(); upstream.destroy(); });
    }
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const pool = new pg.Pool({ ...config, port: proxy.address().port, max: 1, query_timeout: 3000 });
  pool.on('error', () => {});
  try {
    const client = await pool.connect();
    client.on('error', () => {});
    const query = client.query.bind(client);
    client.query = (sql, ...args) => { if (sql === 'COMMIT') armed = true; return query(sql, ...args); };
    try { return await operation(client); }
    finally { assert.equal(sawCommit, true, 'Proxy must observe actual COMMIT completion before dropping acknowledgement'); }
  } finally {
    for (const socket of sockets) socket.destroy();
    await pool.end();
    await new Promise(resolve => proxy.close(resolve));
  }
}

export async function verifyPostgresCommitLoss(config) {
  let callbackCalls = 0;
  await assert.rejects(withPostgresCommitLoss(config, client => runPostgresTransaction({ connect: async () => client }, async tx => {
    callbackCalls++;
    await tx.query('INSERT INTO integrity_fixture VALUES(3,77)');
    return 'must-not-report-success';
  })), error => error.code === 'DATABASE_COMMIT_UNCERTAIN' && error.database === 'postgresql' && error.status === 503);
  assert.equal(callbackCalls, 1);
  const control = new pg.Client(config);
  try {
    await control.connect();
    assert.equal((await control.query('SELECT value FROM integrity_fixture WHERE id=3')).rows[0].value, 77);
    assert.equal((await control.query('SELECT count(*) FROM integrity_fixture WHERE id=3')).rows[0].count, '1');
  } finally { await control.end(); }
}
