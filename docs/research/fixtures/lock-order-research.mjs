// Research-only: synthetic owned PostgreSQL. Does not import env.js, contact a
// configured store/provider, or change application source.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
process.env.NODE_ENV='test';
process.env.DMILLS_REQUIRE_PERSISTENCE='false';
delete process.env.MONGODB_URI;delete process.env.MONGODB_DB;delete process.env.INVENTORY_CREDENTIAL_KEY;
const project='/Users/shreshthagupta/AI-Workspaces/oms-wms';
const require=createRequire(project+'/package.json');const pg=require('pg');
const root=await mkdtemp(join(tmpdir(),'oms-lock-research-'));
const env={PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'C',TMPDIR:root,NODE_ENV:'test'};
const exit=c=>c.exitCode!==null?Promise.resolve(c.exitCode):new Promise((resolve,reject)=>{c.once('exit',resolve);c.once('error',reject);});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,admin,pool;
globalThis.fetch=async()=>{throw Error('Provider fetch forbidden in this research fixture');};
const output={date:'2026-10-15',scope:'Owned disposable PostgreSQL; actual receiveCentralInboundStock and processInventoryTask/shopify path; synthetic data; forced first-lock interleaving',provider_calls:0};
try {
 const init=spawn('/opt/homebrew/bin/initdb',['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale'],{env,stdio:'ignore'});assert.equal(await exit(init),0);
 const probe=createServer();probe.listen(0,'127.0.0.1');await new Promise(resolve=>probe.once('listening',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 server=spawn('/opt/homebrew/bin/postgres',['-D',join(root,'data'),'-h','127.0.0.1','-p',String(port),'-k',root],{env,stdio:'ignore'});
 for(let i=0;i<100;i++){
  assert.equal(server.exitCode,null,'Owned server must remain live');
  const candidate=new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:200});
  try{await candidate.connect();admin=candidate;break;}catch{await candidate.end().catch(()=>{});await pause(100);}
 }
 assert.ok(admin);await admin.query('CREATE DATABASE lock_research_test');
 process.env.INVENTORY_DATABASE_URL=`postgresql://postgres@127.0.0.1:${port}/lock_research_test`;
 process.env.INVENTORY_ALLOWED_TENANT_ID='research-lock-order';delete process.env.INVENTORY_DB_SSL;
 const {inventoryPool,migrateInventory}=await import(project+'/inventory/db.js');
 const {receiveCentralInboundStock}=await import(project+'/inventory/wms-operations.js');
 const {processInventoryTask}=await import(project+'/inventory/workers.js');
 const {applyInventoryEvent}=await import(project+'/inventory/ledger.js');
 pool=inventoryPool();await migrateInventory();
 const tenant='research-lock-order',location=randomUUID(),account=randomUUID(),order=randomUUID();
 const high='ffffffff-ffff-4fff-8fff-ffffffffffff',low='00000000-0000-4000-8000-000000000001';
 await pool.query("INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$3,'A','Synthetic A'),($2,$3,'B','Synthetic B')",[high,low,tenant]);
 await pool.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'OWNED','warehouse')",[location,tenant]);
 await pool.query("INSERT INTO ci_channel_account(id,tenant_id,platform,external_account_id,status) VALUES($1,$2,'shopify','research.invalid','active')",[account,tenant]);
 for(const [id,sku]of[[high,'A'],[low,'B']]){
  await pool.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,active) VALUES($1,$2,$3,$4,$5,true)",[tenant,account,id,location,sku]);
  await applyInventoryEvent({tenantId:tenant,masterSkuId:id,locationId:location,eventKey:'opening:'+sku,eventType:'count',source:'owned-research',delta_on_hand:10});
 }
 await pool.query("INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status) VALUES($1,$2,$3,'shopify','owned-order','created')",[order,tenant,account]);
 await pool.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity) VALUES($1,$2,'line-A','A',1),($1,$2,'line-B','B',1)",[tenant,order]);
 const receipt={requestId:randomUUID(),inboundNo:'OWNED-IN',poNo:'OWNED-PO',locationCode:'OWNED',lines:[{skuCode:'A',quantity:1},{skuCode:'B',quantity:1}],allowedQuantities:new Map([['A',10],['B',10]])};
 const task={tenant_id:tenant,account_id:account,task_type:'shopify_ingress',payload:{topic:'orders/create',event:{id:'owned-order',line_items:[{id:'line-A',sku:'A',quantity:1},{id:'line-B',sku:'B',quantity:1}]}}};
 let releaseBarrier;const barrier=new Promise(resolve=>{releaseBarrier=resolve;});let arrivals=0;
 const firstLocks=[];const connect=pool.connect.bind(pool);
 pool.connect=async function(...args){
  if(args.length)return connect(...args);
  const client=await connect();const query=client.query.bind(client),release=client.release.bind(client);let first=true;
  await query("SET deadlock_timeout='100ms'");await query("SET statement_timeout='10s'");
  client.query=async function(...params){
   const result=await query(...params);
   if(first&&typeof params[0]==='string'&&params[0]==='SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE'){
    first=false;firstLocks.push(params[1][1]);arrivals++;if(arrivals===2)releaseBarrier();await barrier;
   }
   return result;
  };
  client.release=function(...params){client.query=query;client.release=release;return release(...params);};
  return client;
 };
 let guard;const timeout=new Promise((_,reject)=>{guard=setTimeout(()=>{releaseBarrier();reject(Error('Research barrier timed out'));},12000);});
 let outcomes;
 try{outcomes=await Promise.race([Promise.allSettled([receiveCentralInboundStock(receipt),processInventoryTask(task)]),timeout]);}
 finally{clearTimeout(guard);pool.connect=connect;}
 assert.equal(arrivals,2);assert.deepEqual(new Set(firstLocks),new Set([high,low]));
 output.first_locks=firstLocks;
 output.outcomes=outcomes.map((x,i)=>({operation:i===0?'inbound_receipt':'shopify_order',status:x.status,error_code:x.status==='rejected'?x.reason.code:null}));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.code==='40P01').length,1,'Must reproduce PostgreSQL deadlock, not an unrelated error');
 const state=async()=>({balances:(await pool.query('SELECT s.sku,b.on_hand::int,b.reserved_order::int FROM ci_inventory_balance b JOIN ci_master_sku s ON s.id=b.master_sku_id WHERE b.tenant_id=$1 ORDER BY s.sku',[tenant])).rows,events:(await pool.query('SELECT event_type,count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1 GROUP BY event_type ORDER BY event_type',[tenant])).rows,reservations:(await pool.query('SELECT count(*)::int AS n FROM ci_reservation WHERE tenant_id=$1',[tenant])).rows[0].n});
 const partial=await state();output.after_deadlock=partial;
 if(outcomes[0].status==='fulfilled')assert.deepEqual(partial.balances.map(x=>[x.on_hand,x.reserved_order]),[[11,0],[11,0]]);
 else assert.deepEqual(partial.balances.map(x=>[x.on_hand,x.reserved_order]),[[10,1],[10,1]]);
 assert.equal(partial.events.reduce((n,x)=>n+x.n,0),4,'Exactly two opening and two winning operation events, never a partial losing operation');
 if(outcomes[0].status==='rejected')await receiveCentralInboundStock(receipt);else await processInventoryTask(task);
 const recovered=await state();assert.deepEqual(recovered.balances.map(x=>[x.on_hand,x.reserved_order]),[[11,1],[11,1]]);assert.equal(recovered.reservations,2);assert.equal(recovered.events.reduce((n,x)=>n+x.n,0),6);
 await receiveCentralInboundStock(receipt);await processInventoryTask(task);assert.deepEqual(await state(),recovered);
 output.after_retry_and_replay=recovered;output.reproduction='CONFIRMED';output.lock_order_consistency='FAIL';output.atomic_rollback='PASS';output.same_identity_recovery='PASS';output.exact_replay='PASS';
 output.source_hashes={};for(const f of['inventory/ledger.js','inventory/workers.js','inventory/wms-operations.js'])output.source_hashes[f]=createHash('sha256').update(await readFile(project+'/'+f)).digest('hex');
 await writeFile('/private/tmp/oms-lock-order-research-result.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output,null,2));
}finally{
 if(pool)await pool.end();if(admin)await admin.end();
 if(server&&server.exitCode===null){const stopped=exit(server);server.kill('SIGTERM');await stopped;}
 await rm(root,{recursive:true,force:true});
}
