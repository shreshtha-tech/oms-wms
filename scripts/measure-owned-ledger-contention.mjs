import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { platform, arch } from 'node:os';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
validateTestStores(process.env);
const db = inventoryPool(), tenant = 'owned-ledger-measurement', sku = randomUUID(), location = randomUUID();
const samples = [], count = 100, concurrency = 4;
const lag = monitorEventLoopDelay({ resolution: 10 });
const cpuBefore = process.cpuUsage();
let maxRss = process.memoryUsage().rss;
const timer = setInterval(() => { maxRss = Math.max(maxRss, process.memoryUsage().rss); }, 10);
async function stage(name, operation) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) {
      const index = next++, start = performance.now();
      await operation(index);
      samples.push({ stage: name, index, milliseconds: performance.now() - start });
    }
  }));
}
try {
  await writeFile(new URL('../docs/hardening/ledger-contention-evidence.json', import.meta.url), JSON.stringify({ status: 'RUNNING', scope: 'DISPOSABLE_LEDGER_CONTENTION_NOT_LAUNCH_CAPACITY', generatedAt: new Date().toISOString() }) + '\n');
  await migrateInventory();
  await db.query("INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,'OWNED-LOAD','Owned fixture')", [sku, tenant]);
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'OWNED-WH','warehouse')", [location, tenant]);
  const base = { tenantId: tenant, masterSkuId: sku, locationId: location, source: 'owned-load' };
  await applyInventoryEvent({ ...base, eventKey: 'opening', eventType: 'count', delta_on_hand: count });
  const reserve = index => ({ ...base, eventKey: `reserve-${index}`, eventType: 'reserve', delta_reserved_order: 1,
    reservation: { action: 'reserve', orderId: `owned-order-${index}`, lineId: 'line-1', quantity: 1 } });
  lag.enable();
  const started = performance.now();
  await stage('reserve', index => applyInventoryEvent(reserve(index)));
  await stage('release', index => applyInventoryEvent({ ...base, eventKey: `release-${index}`, eventType: 'cancel', delta_reserved_order: -1,
    reservation: { action: 'release', orderId: `owned-order-${index}`, lineId: 'line-1', quantity: 1 } }));
  await stage('duplicate-replay', async index => { assert.equal((await applyInventoryEvent(reserve(index))).duplicate, true); });
  const durationMs = performance.now() - started;
  assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1', [tenant])).rows[0].count, '201');
  const balance = (await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1', [tenant])).rows[0];
  assert.equal(Number(balance.on_hand), 100); assert.equal(Number(balance.reserved_order), 0);
  assert.equal((await db.query("SELECT count(*) FROM ci_reservation WHERE tenant_id=$1 AND status='released'", [tenant])).rows[0].count, '100');
  const summary = Object.fromEntries(['reserve', 'release', 'duplicate-replay'].map(name => {
    const values = samples.filter(row => row.stage === name).map(row => row.milliseconds).sort((a, b) => a - b);
    const percentile = percent => values[Math.ceil(values.length * percent) - 1];
    return [name, { count: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: values.at(-1) }];
  }));
  const evidence = { status: 'PASS', scope: 'DISPOSABLE_LEDGER_CONTENTION_NOT_LAUNCH_CAPACITY', generatedAt: new Date().toISOString(),
    runtime: process.version, host: { platform: platform(), arch: arch() }, workload: { orders: count, concurrency, skus: 1, locations: 1, accounts: 0 },
    durationMs, summary, samples, cpuMicroseconds: process.cpuUsage(cpuBefore), maxRssBytes: maxRss,
    eventLoopP99Ms: Number.isFinite(lag.percentile(99)) ? lag.percentile(99) / 1e6 : null,
    correctness: { events: 201, releasedReservations: 100, onHand: 100, reservedOrder: 0 },
    limitations: ['No HTTP/order intake/provider/hosted traffic.', 'Finite four-worker fixture; no launch targets or saturation/soak acceptance.', 'CPU includes setup; RSS sampled every 10ms; measurements are host-specific.'] };
  await writeFile(new URL('../docs/hardening/ledger-contention-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', durationMs, summary, correctness: evidence.correctness }));
} catch (error) {
  await writeFile(new URL('../docs/hardening/ledger-contention-evidence.json', import.meta.url), JSON.stringify({ status: 'FAIL', generatedAt: new Date().toISOString(), completedOperations: samples.length, errorCategory: error.name }) + '\n');
  throw error;
} finally { clearInterval(timer); lag.disable(); await db.end(); }
