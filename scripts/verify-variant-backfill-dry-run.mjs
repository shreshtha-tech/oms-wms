import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
const tenantId = `variant-backfill-${randomUUID()}`;
const root = await mkdtemp(join(tmpdir(), 'variant-backfill-test-'));
const pg = inventoryPool(), mongo = new MongoClient(process.env.MONGODB_URI);
try {
  await migrateInventory();
  await mongo.connect();
  for (const [kind, code] of [['brand', 'ACME'], ['brand', 'ZED'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '32']]) {
    await pg.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [tenantId, kind, code]);
  }
  for (const sku of ['ACME-JEANS-SLIM-BLACK-32', 'ZED-JEANS-SLIM-BLACK-32']) {
    await pg.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3)', [tenantId, sku, 'Dry-run source']);
  }
  await mongo.db(process.env.MONGODB_DB).collection('skus').insertOne({ sku_code: 'ACME-JEANS-SLIM-BLACK-32', brand: 'ACME', category: 'JEANS', style: 'SLIM', color: 'BLACK', size: '32' });
  const run = () => {
    const stdout = execFileSync(process.execPath, ['scripts/variant-backfill.mjs', '--dry-run'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, INVENTORY_ALLOWED_TENANT_ID: tenantId, VARIANT_BACKFILL_OUTPUT_ROOT: root },
      encoding: 'utf8', timeout: 20000,
    });
    const record = stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(line => line?.kind === 'variant_backfill_dry_run');
    assert.ok(record, 'Dry-run process must report its artifact directory');
    return record;
  };
  const first = run(), second = run();
  assert.equal(first.summary.sha256, second.summary.sha256);
  assert.equal(first.summary.variants, 1);
  assert.equal(first.summary.mergeable, 1);
  for (const directory of [first.directory, second.directory]) {
    assert.deepEqual((await readdir(directory)).sort(), ['conflicts.csv', 'mergeable.json', 'review.csv', 'summary.json', 'variants.csv']);
    assert.match(await readFile(join(directory, 'variants.csv'), 'utf8'), /JEANS\|SLIM\|BLACK\|32/);
    assert.equal(JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')).sha256, first.summary.sha256);
  }
  console.log('PASS variant backfill dry run: five review artifacts, tenant-scoped two-source read and repeatable plan hash');
} finally {
  await mongo.close();
  await pg.end();
  await rm(root, { recursive: true, force: true });
}
