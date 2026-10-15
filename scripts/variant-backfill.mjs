import '../env.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inventoryPool } from '../inventory/db.js';
import { closeDataStore } from '../api/mongo.js';
import { applyVariantBackfill } from '../inventory/variant-backfill-apply.js';
import { readVariantBackfillPlan } from '../inventory/variant-backfill-source.js';
import { renderVariantBackfillArtifacts } from '../inventory/variant-backfill-artifacts.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
if (apply ? args.length !== 5 || args[0] !== '--apply' || args[1] !== '--plan' || args[3] !== '--expect-hash' : args.some(arg => arg !== '--dry-run')) throw new Error('Use --dry-run, or --apply --plan <directory> --expect-hash <sha256>');
const tenantId = process.env.INVENTORY_ALLOWED_TENANT_ID;
if (!tenantId || !process.env.INVENTORY_DATABASE_URL || !process.env.MONGODB_URI) throw new Error('Configured tenant, PostgreSQL and MongoDB are required for two-source backfill planning');
const db = inventoryPool();
try {
  if (apply) {
    const planDirectory = resolve(args[2]);
    const summary = JSON.parse(await readFile(resolve(planDirectory, 'summary.json'), 'utf8'));
    const reviewedMergeable = JSON.parse(await readFile(resolve(planDirectory, 'mergeable.json'), 'utf8'));
    if (summary.tenant_id !== tenantId || summary.sha256 !== args[4]) throw Object.assign(new Error('Reviewed backfill plan tenant or hash mismatch'), { code: 'PLAN_HASH_MISMATCH' });
    const stored = await db.query('SELECT plan_state FROM ci_variant_backfill_plan WHERE tenant_id=$1 AND plan_hash=$2', [tenantId, args[4]]);
    const plan = stored.rows[0]?.plan_state ?? await readVariantBackfillPlan(db, tenantId);
    const rendered = renderVariantBackfillArtifacts(plan);
    for (const [name, content] of Object.entries(rendered.files)) {
      if (await readFile(resolve(planDirectory, name), 'utf8') !== content) throw Object.assign(new Error('Reviewed plan artifact changed'), { code: 'PLAN_ARTIFACT_CHANGED' });
    }
    const result = await applyVariantBackfill({ tenantId, expectHash: args[4], currentPlan: stored.rowCount ? null : plan, reviewedMergeable });
    const held = result.results.filter(row => row.held).length;
    console.log(JSON.stringify({ kind: 'variant_backfill_apply', state: held ? 'HELD' : 'COMPLETE', held, ...result }));
    if (held) process.exitCode = 2;
  } else {
  const plan = await readVariantBackfillPlan(db, tenantId);
  const rendered = renderVariantBackfillArtifacts(plan);
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const directory = resolve(process.env.VARIANT_BACKFILL_OUTPUT_ROOT || 'artifacts/variant-backfill', `${timestamp}-${plan.summary.sha256.slice(0, 8)}`);
  await mkdir(directory, { recursive: false });
  await Promise.all(Object.entries(rendered.files).map(([name, content]) => writeFile(resolve(directory, name), content)));
  console.log(JSON.stringify({ kind: 'variant_backfill_dry_run', directory, summary: rendered.summary }));
  }
} catch (error) {
  console.error(JSON.stringify({ kind: 'variant_backfill_error', reason: error?.reason || error?.code || 'BACKFILL_FAILED' }));
  process.exitCode = 1;
} finally {
  await closeDataStore();
  await db.end();
}
