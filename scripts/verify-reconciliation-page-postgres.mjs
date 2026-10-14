import assert from 'node:assert/strict';
import { readReconciliationPage } from '../inventory/reconciliation-page.js';
export async function verifyReconciliationPagePostgres(db) {
  await db.query('CREATE TEMP TABLE keyset_mapping(tenant_id text,id uuid)');
  await db.query(`INSERT INTO keyset_mapping SELECT 'page-a', ('00000000-0000-0000-0000-'||lpad(to_hex(i),12,'0'))::uuid FROM generate_series(1,205) i;
    INSERT INTO keyset_mapping VALUES('page-b','00000000-0000-0000-0000-000000000001');`);
  const sql = 'SELECT m.id AS mapping_id FROM keyset_mapping m WHERE m.tenant_id=$1';
  const pages = [];
  for (let i = 0; i < 3; i++) pages.push(await readReconciliationPage(db, sql, 'page-a', 'owned-fixture'));
  assert.deepEqual(pages.map(page => page.length), [100, 100, 5]);
  assert.equal(new Set(pages.flat().map(row => row.mapping_id)).size, 205);
  const wrapped = await readReconciliationPage(db, sql, 'page-a', 'owned-fixture');
  assert.deepEqual(wrapped, pages[0]);
  const other = await readReconciliationPage(db, sql, 'page-b', 'owned-fixture');
  assert.equal(other.length, 1);
  assert.equal((await readReconciliationPage(db, sql, 'page-empty', 'owned-fixture')).length, 0);
  await db.query('DROP TABLE keyset_mapping');
  await db.query('CREATE TEMP TABLE keyset_task(tenant_id text,id bigint,mapping_id uuid)');
  await db.query(`INSERT INTO keyset_task SELECT 'page-a',9007199254740992::bigint+i,'00000000-0000-0000-0000-000000000001'::uuid FROM generate_series(1,205) i`);
  const taskSql = 'SELECT o.id AS task_id,o.mapping_id FROM keyset_task o WHERE o.tenant_id=$1';
  const taskPages = [];
  for (let i = 0; i < 3; i++) taskPages.push(await readReconciliationPage(db, taskSql, 'page-a', 'owned-fixture', 'task'));
  assert.deepEqual(taskPages.map(page => page.length), [100, 100, 5]);
  assert.equal(new Set(taskPages.flat().map(row => row.task_id)).size, 205, 'Task cursor must retain bigint precision and cover multiple tasks on the same mapping');
  assert.deepEqual(await readReconciliationPage(db, taskSql, 'page-a', 'owned-fixture', 'task'), taskPages[0]);
  await db.query('DROP TABLE keyset_task');
}
