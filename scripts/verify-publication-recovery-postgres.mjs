import assert from 'node:assert/strict';
import pg from 'pg';
import { recoverExpiredPublications } from '../inventory/publication-recovery.js';
import { inventoryDriftCount } from '../inventory/drift-count.js';

export async function verifyPublicationRecoveryPostgres(config) {
  const first = new pg.Client(config), second = new pg.Client(config);
  await first.connect();
  try {
    await second.connect();
    await first.query(`CREATE TABLE ci_outbox(id integer PRIMARY KEY,tenant_id text,task_type text,status text,
      lease_until timestamptz,remote_attempt_started_at timestamptz,acknowledged_at timestamptz,
      publication_state text,last_error text,mapping_id text,remote_target_quantity integer);
      CREATE TABLE ci_channel_stock(tenant_id text,mapping_id text,target_quantity integer,publish_state text,updated_at timestamptz,PRIMARY KEY(tenant_id,mapping_id));
      INSERT INTO ci_outbox(id,tenant_id,task_type,status,lease_until,remote_attempt_started_at,acknowledged_at,mapping_id,remote_target_quantity)
      SELECT i,CASE WHEN i=5 THEN 'tenant-b' ELSE 'tenant-a' END,'publish_stock','processing',now()-interval '1 minute',now()-interval '2 minutes',
      CASE WHEN i%2=0 THEN now()-interval '90 seconds' ELSE NULL END,'mapping-'||i,CASE WHEN i=1 THEN 0 ELSE i END FROM generate_series(1,5) i;`);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await second.query("SET LOCAL statement_timeout='1s'");
    await recoverExpiredPublications(first, 'tenant-a', 2);
    await recoverExpiredPublications(second, 'tenant-a', 2);
    assert.deepEqual((await first.query("SELECT id FROM ci_outbox WHERE status='held' ORDER BY id")).rows.map(row => row.id), [1, 2]);
    assert.deepEqual((await second.query("SELECT id FROM ci_outbox WHERE status='held' ORDER BY id")).rows.map(row => row.id), [3, 4]);
    await first.query('ROLLBACK');
    await second.query('COMMIT');
    assert.deepEqual((await first.query('SELECT mapping_id FROM ci_channel_stock ORDER BY mapping_id')).rows.map(row => row.mapping_id), ['mapping-3', 'mapping-4']);
    await first.query('BEGIN');
    await recoverExpiredPublications(first, 'tenant-a', 2);
    await first.query('COMMIT');
    const rows = (await first.query('SELECT id,status,publication_state FROM ci_outbox ORDER BY id')).rows;
    assert.equal(rows.filter(row => row.status === 'held').length, 4);
    assert.deepEqual(rows[4], { id: 5, status: 'processing', publication_state: null });
    assert.deepEqual((await first.query("SELECT target_quantity,publish_state FROM ci_channel_stock WHERE mapping_id='mapping-1'")).rows[0], { target_quantity: 0, publish_state: 'unknown_remote' });
    assert.equal((await first.query("SELECT publish_state FROM ci_channel_stock WHERE mapping_id='mapping-2'")).rows[0].publish_state, 'readback_pending');
    await first.query(`ALTER TABLE ci_channel_stock ADD COLUMN observed_quantity integer;
      CREATE TABLE ci_channel_mapping(tenant_id text,id text);
      INSERT INTO ci_channel_mapping SELECT tenant_id,mapping_id FROM ci_channel_stock;
      UPDATE ci_channel_stock SET observed_quantity=target_quantity;
      UPDATE ci_channel_stock SET observed_quantity=99 WHERE mapping_id IN ('mapping-1','mapping-2');
      INSERT INTO ci_channel_mapping VALUES('tenant-b','foreign-mapping');
      INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,observed_quantity) VALUES('tenant-a','foreign-mapping',1,2);`);
    assert.equal(await inventoryDriftCount(first, 'tenant-a'), 2, 'Drift aggregate must exclude a mapping owned by another tenant');
    assert.equal(await inventoryDriftCount(first, 'tenant-empty'), 0);
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    await first.end(); await second.end();
  }
}
