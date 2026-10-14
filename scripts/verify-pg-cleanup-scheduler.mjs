import assert from 'node:assert/strict';
import { createPgCleanupScheduler } from '../reliability/pg-cleanup-scheduler.js';
import { metricSnapshot } from '../reliability/telemetry.js';

const waitFor = async predicate => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Cleanup scheduler observation timed out');
};
let releaseFirst;
const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
let calls = 0, active = 0, maximum = 0;
const schedule = createPgCleanupScheduler({ sql: 'fixture', batchSize: 1000, metric: 'fixture_cleanup_failure', event: 'fixture_cleanup_failed', query: async () => {
  calls++;
  active++;
  maximum = Math.max(maximum, active);
  if (calls === 1) await firstBlocked;
  active--;
  return { rowCount: 0 };
} });
schedule();
await waitFor(() => calls === 1);
for (let index = 0; index < 1000; index++) schedule();
assert.equal(calls, 1, 'Bursty requests do not start or queue one cleanup per call');
releaseFirst();
await waitFor(() => calls === 2);
assert.equal(maximum, 1, 'Only one cleanup query runs at once');
const failing = createPgCleanupScheduler({ sql: 'fixture', batchSize: 1000, metric: 'fixture_cleanup_failure', event: 'fixture_cleanup_failed', query: async () => { throw new Error('synthetic failure'); } });
failing();
await waitFor(() => metricSnapshot().some(row => row.name === 'fixture_cleanup_failure' && row.value === 1));
console.log('PASS PostgreSQL cleanup scheduler: 1,000 requests coalesce into one rerun, query concurrency stays one and failure is counted');
