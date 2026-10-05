import { inventoryPool, inventoryDatabaseStatus } from '../inventory/db.js';
import { dataStoreStatus } from '../api/mongo.js';
import { metricSnapshot } from './telemetry.js';
export const alertThresholds = {
  databaseUnavailableSeconds: 30, poolWaitingRequests: 5, fiveXxRatio: 0.02, rateLimitedRatio: 0.05,
  providerTimeoutRatio: 0.05, pendingJobs: 100, oldestPendingSeconds: 300, deadJobs: 1, workerHeartbeatAgeSeconds: 90,
};
export async function operationsStatus(_req, res) {
  const tenant = process.env.INVENTORY_ALLOWED_TENANT_ID;
  if (!tenant) return res.status(503).json({ error: 'TENANT_NOT_CONFIGURED', message: 'Operational monitoring requires an inventory tenant.' });
  try {
    const queue = (await inventoryPool().query(`SELECT count(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending,
      count(*) FILTER (WHERE status='dead')::int AS dead,
      extract(epoch FROM (now()-min(created_at) FILTER (WHERE status IN ('pending','retry')))) AS oldest_seconds
      FROM ci_outbox WHERE tenant_id=$1`, [tenant])).rows[0];
    const worker = (await inventoryPool().query("SELECT extract(epoch FROM (now()-last_seen_at)) AS age_seconds FROM ci_service_heartbeat WHERE tenant_id=$1 AND service='inventory-worker'", [tenant])).rows[0];
    const postgres = inventoryDatabaseStatus(), mongo = dataStoreStatus();
    const alerts = [];
    if (mongo.state !== 'READY' && process.env.MONGODB_URI) alerts.push('mongodb_unavailable');
    if (postgres.waiting >= alertThresholds.poolWaitingRequests) alerts.push('postgresql_pool_pressure');
    if (queue.pending >= alertThresholds.pendingJobs) alerts.push('queue_backlog');
    if (queue.dead >= alertThresholds.deadJobs) alerts.push('dead_letter_jobs');
    if (Number(queue.oldest_seconds) >= alertThresholds.oldestPendingSeconds) alerts.push('queue_age');
    if (!worker || Number(worker.age_seconds) >= alertThresholds.workerHeartbeatAgeSeconds) alerts.push('worker_heartbeat_missing');
    res.json({ databases: { mongodb: mongo, postgresql: postgres }, queue, worker: worker || { state: 'UNAVAILABLE' }, alerts, thresholds: alertThresholds, metrics: metricSnapshot(), metricScope: 'process lifetime; scrape externally for time-window thresholds' });
  } catch { res.status(503).json({ error: 'MONITORING_UNAVAILABLE', database: 'postgresql', message: 'Operational dependency status is unavailable.' }); }
}
