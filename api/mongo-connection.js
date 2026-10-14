import { increment, logEvent } from '../reliability/telemetry.js';
import { MongoClient, MongoNetworkError } from 'mongodb';
import { inspectMongoDataset } from './mongo-dataset.js';

export const databaseUnavailable = () => Object.assign(new Error('The requested module is temporarily unavailable because its database dependency is unavailable.'), {
  status: 503, statusCode: 503, code: 'DATABASE_UNAVAILABLE', database: 'mongodb',
});
export const databaseTimeout = () => Object.assign(new Error('The database operation timed out. Please try again.'), {
  status: 504, statusCode: 504, code: 'DATABASE_TIMEOUT', database: 'mongodb',
});
export const isConnectionError = error => error instanceof MongoNetworkError || ['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND'].includes(error?.code) || error?.name === 'PoolClearedOnNetworkError' || error?.code === 'DATABASE_UNAVAILABLE' || error?.code === 18 || error?.name === 'MongoAuthenticationError'
  || /Mongo(Network|ServerSelection|TopologyClosed|NotConnected|PoolCleared|PoolClosed|WaitQueueTimeout|OperationTimeout|ClientClosed)/.test(error?.name || '');

// One driver pool; a rejected attempt is never retained. The driver monitors
// topology and reconnects. Application retries are single-flight and bounded.
export function createMongoConnection({ uri, database, Client = MongoClient, retryMs = 1000, log = console.error }) {
  let client, db, pending, stopped = false, retryAt = 0;
  let state = 'STARTING', failures = 0;
  let reason = null;
  let dataset = null, datasetPending = null, datasetAt = 0;
  function failed(error) {
    const previous = state; state = 'DEGRADED';
    logEvent('database_state', { database: 'mongodb', previous, state });
    failures++;
    increment('database_errors_total', { database: 'mongodb' });
    dataset = null; datasetAt = 0;
    const errors = [error, error?.cause, ...Array.from(error?.reason?.servers?.values?.() || []).flatMap(server => [server.error, server.error?.cause])].filter(Boolean);
    const tlsHandshakeFailed = errors.some(item => item.code === 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR' || /alert (?:number )?80|TLSV1_ALERT_INTERNAL_ERROR/i.test(item.message || ''));
    reason = errors.some(item => item.code === 18 || item.codeName === 'AuthenticationFailed' || item.name === 'MongoAuthenticationError') ? 'AUTHENTICATION_FAILED' : tlsHandshakeFailed ? 'TLS_HANDSHAKE_FAILED' : 'UNREACHABLE';
    retryAt = Date.now() + Math.min(30000, retryMs * 2 ** Math.min(failures - 1, 5)) * (0.75 + Math.random() * 0.5);
    // Error messages can contain credentials/URIs. Log only classifications.
    log('[data] MongoDB dependency failure', { reason });
    if (tlsHandshakeFailed) {
      log('[data] connection refused before certificate exchange: check Atlas Network Access allowlist and cluster state');
    }
  }
  async function connect() {
    if (stopped) throw databaseUnavailable();
    if (pending) return pending;
    if (db && state === 'READY') return db;
    if (Date.now() < retryAt) throw databaseUnavailable();
    state = failures ? 'RECONNECTING' : 'CONNECTING';
    // Defer work until pending is assigned, including synchronous constructor
    // failures; otherwise finally can clear it before assignment restores it.
    pending = Promise.resolve().then(async () => {
      try {
        if (!client) {
          client = new Client(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 15000, maxPoolSize: 10, minPoolSize: 0, maxConnecting: 2, waitQueueTimeoutMS: 5000, maxIdleTimeMS: 60000 });
          client.on?.('topologyDescriptionChanged', event => {
            if (state === 'READY' && ['Unknown', 'ReplicaSetNoPrimary'].includes(event.newDescription?.type)) {
              state = 'DEGRADED'; reason = 'TOPOLOGY_UNAVAILABLE';
            }
          });
        }
        await client.connect();
        const candidate = client.db(database);
        await candidate.command({ ping: 1 });
        if (stopped) throw databaseUnavailable();
        db = candidate;
        logEvent('database_state', { database: 'mongodb', previous: state, state: 'READY' });
        state = 'READY'; reason = null; retryAt = 0; failures = 0;
        return db;
      } catch (error) { failed(error); throw databaseUnavailable(); }
      finally { pending = null; }
    });
    return pending;
  }
  return {
    connect,
    client: () => client,
    status: () => ({ database: 'mongodb', state, reason }),
    async datasetStatus() {
      if (dataset && Date.now() - datasetAt < 15000 && state === 'READY') return dataset;
      if (datasetPending) return datasetPending;
      datasetPending = (async () => {
        try {
          const result = await inspectMongoDataset(await connect());
          if (state === 'READY') { dataset = result; datasetAt = Date.now(); }
          return result;
        } catch (error) {
          if (isConnectionError(error) || error?.code === 18) {
            if (error.code !== 'DATABASE_UNAVAILABLE') failed(error);
            return { datasetState: reason === 'AUTHENTICATION_FAILED' ? 'AUTHENTICATION_FAILED' : 'UNREACHABLE', datasetEmpty: null };
          }
          return { datasetState: error?.code === 13 ? 'ACCESS_DENIED' : 'INSPECTION_UNAVAILABLE', datasetEmpty: null };
        } finally { datasetPending = null; }
      })();
      return datasetPending;
    },
    async probe() {
      try { await (await connect()).command({ ping: 1 }); return this.status(); }
      catch (error) { if (error.code !== 'DATABASE_UNAVAILABLE') failed(error); throw databaseUnavailable(); }
    },
    async run(operation) {
      try { return await operation(); }
      catch (error) {
        if ([50, 262].includes(error?.code) || error?.name === 'MongoOperationTimeoutError') {
          increment('database_errors_total', { database: 'mongodb', code: 'DATABASE_TIMEOUT' });
          throw databaseTimeout();
        }
        if (!isConnectionError(error)) throw error;
        if (error.code !== 'DATABASE_UNAVAILABLE') failed(error);
        throw databaseUnavailable();
      }
    },
    async close() { stopped = true; state = 'STOPPING'; if (pending) await pending.catch(() => {}); if (client) await client.close(); db = null; state = 'STOPPED'; },
  };
}
