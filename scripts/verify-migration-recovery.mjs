import assert from 'node:assert/strict';
import pg from 'pg';
import { inventoryPool,migrateInventory } from '../inventory/db.js';

const url=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(url.hostname)||!/^\/codexqa_test_migrations_/.test(url.pathname))throw new Error('Use the isolated migration runner');
const db=inventoryPool();
const repair=new pg.Client({connectionString:url.toString()});
try{
 await repair.connect();
 const firstStartup=await Promise.allSettled(Array.from({length:4},()=>migrateInventory()));
 assert.ok(firstStartup.every(result=>result.status==='fulfilled'),`Concurrent first startup must serialize schema creation: ${JSON.stringify(firstStartup.map(r=>r.status==='rejected'?r.reason.code:r.status))}`);
 await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES('migration-fixture','PRESERVE','Preserved fixture')");
 const schema=()=>db.query("SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relname LIKE 'ci_%' ORDER BY c.relname,k.conname");
 const before=(await schema()).rows;await migrateInventory();assert.deepEqual((await schema()).rows,before,'Repeat migration must preserve constraint definitions');
 assert.equal((await db.query("SELECT count(*) FROM ci_master_sku WHERE tenant_id='migration-fixture'")).rows[0].count,'1');
 // Inject incompatible schema only in this generated database; no SQL files change.
 await repair.query('DROP INDEX ci_observation_sku');
 await repair.query('ALTER TABLE ci_stock_observation RENAME TO codexqa_saved_observation');
 await repair.query('CREATE TABLE ci_stock_observation(id integer)');
 try{
  await assert.rejects(()=>migrateInventory(),error=>error.code==='42703');
  assert.equal((await db.query('SELECT 1 AS healthy')).rows[0].healthy,1,'Failed migration must not return an aborted transaction to the pool');
 }finally{
  await repair.query('DROP TABLE ci_stock_observation');
  await repair.query('ALTER TABLE codexqa_saved_observation RENAME TO ci_stock_observation');
 }
 await migrateInventory();
 const simultaneous=await Promise.allSettled([migrateInventory(),migrateInventory()]);
 assert.ok(simultaneous.every(result=>result.status==='fulfilled'),`Concurrent migration runners must serialize: ${JSON.stringify(simultaneous.map(r=>r.status==='rejected'?r.reason.code:r.status))}`);
 assert.deepEqual((await schema()).rows,before);
 assert.equal((await db.query("SELECT count(*) FROM ci_master_sku WHERE tenant_id='migration-fixture'")).rows[0].count,'1');
 const blocker=new pg.Client({connectionString:url.toString()});blocker.on('error',()=>{});
 let waitingMigration;
 try{
  await blocker.connect();
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await blocker.query("SELECT pg_advisory_lock(hashtextextended('ci-schema-migrations',0))");
  waitingMigration=migrateInventory();
  let waiting=false;
  for(let i=0;i<200&&!waiting;i++){
   waiting=(await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ci-schema-migrations%' LIMIT 1")).rowCount>0;
   if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(waiting,'Migration must wait on the actual session lock');
  assert.equal((await db.query('SELECT pg_terminate_backend($1) AS terminated',[pid])).rows[0].terminated,true,'Terminate only the verifier-owned generated-database connection');
  await waitingMigration;
 }finally{await blocker.end().catch(()=>{});if(waitingMigration)await waitingMigration;}
 assert.deepEqual((await schema()).rows,before);
 console.log('PASS migration recovery: repeated and concurrent schema application, constraints/data preserved, injected failure rolled back, pool healthy, repair/retry succeeded.');
}finally{await repair.end();await db.end();}
