import { inventoryPool } from '../inventory/db.js';
import { increment, logEvent } from './telemetry.js';

export function createPgCleanupScheduler({ sql, batchSize, metric, event, query = () => inventoryPool().query(sql) }) {
  let timer = null;
  let dueAt = 0;
  let running = false;
  let requested = false;
  let lastStartedAt = 0;
  function schedule(delayMs = 0) {
    if (running) { requested = true; return; }
    const next = Date.now() + Math.max(delayMs, lastStartedAt + 1000 - Date.now(), 0);
    if (timer && dueAt <= next) return;
    if (timer) clearTimeout(timer);
    dueAt = next;
    timer = setTimeout(async () => {
      timer = null;
      running = true;
      lastStartedAt = Date.now();
      let fullBatch = false;
      try {
        const result = await query();
        fullBatch = result.rowCount === batchSize;
      } catch {
        increment(metric);
        logEvent(event, { code: 'MAINTENANCE_FAILED' });
      } finally {
        running = false;
        const rerun = requested;
        requested = false;
        schedule(rerun || fullBatch ? 0 : 60000);
      }
    }, Math.max(0, next - Date.now()));
    timer.unref?.();
  }
  return schedule;
}
