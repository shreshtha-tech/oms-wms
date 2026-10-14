import pg from 'pg';
import { increment, logEvent } from './telemetry.js';
export const postgresUnavailable = () => Object.assign(new Error('PostgreSQL data is temporarily unavailable.'), { code: 'DATABASE_UNAVAILABLE', database: 'postgresql', status: 503, statusCode: 503 });
export const isPostgresConnectivityError = error => /^(08|53|57P0)/.test(String(error?.code || ''))
  || error?.code === '25P03'
  || ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN'].includes(error?.code)
  || /connection (?:terminated|timeout)|timeout exceeded when trying to connect|pool.*ended|client has encountered a connection error and is not queryable|client was closed and is not queryable/i.test(error?.message || '');
export function createPostgresConnection(options, Pool = pg.Pool) {
  const pool = new Pool({ max: 10, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000, statement_timeout: 15000, idle_in_transaction_session_timeout: 60000, ...options });
  let state = 'STARTING', lastCode = null;
  const transition = next => { if (state !== next) { logEvent('database_state', { database: 'postgresql', previous: state, state: next }); state = next; } };
  const failed = error => {
    lastCode = error?.code || 'CONNECTION_FAILURE'; transition('DEGRADED');
    increment('database_errors_total', { database: 'postgresql', code: lastCode });
  };
  pool.on('error', failed); // idle clients can fail without an active query
  pool.on('connect', () => { lastCode = null; transition('READY'); });
  const query = pool.query.bind(pool), connect = pool.connect.bind(pool), end = pool.end.bind(pool);
  async function run(operation) {
    const start = performance.now();
    try { const result = await operation(); lastCode = null; transition('READY'); return result; }
    catch (error) {
      if (isPostgresConnectivityError(error)) { failed(error); throw postgresUnavailable(); }
      if (error?.code === '57014') throw Object.assign(new Error('Database operation timed out.'), { code: 'DATABASE_TIMEOUT', database: 'postgresql', status: 504, statusCode: 504 });
      throw error;
    } finally { increment('database_duration_ms_total', { database: 'postgresql' }, performance.now() - start); }
  }
  // Preserve callback overloads for existing callers; do not retry mutations.
  pool.query = (...args) => typeof args.at(-1) === 'function' ? query(...args) : run(() => query(...args));
  const wrappedClients = new WeakSet();
  pool.connect = (...args) => typeof args.at(-1) === 'function' ? connect(...args) : run(async () => {
    const client = await connect(...args);
    if (typeof client.query === 'function' && !wrappedClients.has(client)) {
      const clientQuery = client.query.bind(client);
      client.query = (...queryArgs) => typeof queryArgs.at(-1) === 'function' ? clientQuery(...queryArgs) : run(() => clientQuery(...queryArgs));
      wrappedClients.add(client);
    }
    return client;
  });
  pool.end = async () => { transition('STOPPING'); try { await end(); } finally { transition('STOPPED'); } };
  return { pool, status: () => ({ database: 'postgresql', state, code: lastCode, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }), async probe() { await pool.query('SELECT 1'); return this.status(); } };
}
