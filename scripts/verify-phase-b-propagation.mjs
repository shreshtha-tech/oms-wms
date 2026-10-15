import { testBinaryPath } from './lib/test-binaries.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';
import { closeDataStore, mongoDomainTransaction } from '../api/mongo.js';
import { readMongoRows } from '../api/mongo-read.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { withPostgresCommitLoss } from './verify-postgres-commit-loss.mjs';
import inbound from '../api/inbound-create-edit.js';
import realtime from '../api/inbound-realtime.js';
import { stageReceiptCommand, consumeReceiptCommand, projectReceiptResult, runReceiptBridgeBatch } from '../inventory/receipt-bridge.js';
import { consumeEvent, envelope, digest } from '../inventory/domain-events.js';
import { mongoReceiptClaimIndexes } from '../inventory/receipt-claim-query.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
validateTestStores(process.env);
process.env.INVENTORY_ALLOWED_TENANT_ID='phase-b-synthetic';
const tenant=process.env.INVENTORY_ALLOWED_TENANT_ID,sku='PHASE-B-SKU',location='PHASE-B-WH';
const mongo=new MongoClient(process.env.MONGODB_URI),pg=inventoryPool();
const call=async(handler,body)=>{
 const response={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}};
 await handler({method:'POST',body},response);return response;
};
async function state(){
 const events=await pg.query('SELECT id,event_key,delta_on_hand FROM ci_inventory_event WHERE tenant_id=$1 ORDER BY event_key',[tenant]);
 const balance=await pg.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1',[tenant]);
 return {events:events.rows,onHand:Number(balance.rows[0]?.on_hand||0)};
}
try{
 await migrateInventory();await mongo.connect();
 const db=mongo.db(process.env.MONGODB_DB);
 await db.createCollection('_domain_outbox');
 await assert.rejects(()=>runReceiptBridgeBatch(),error=>error.code==='RECEIPT_CLAIM_INDEX_MISSING'&&error.status===503);
 for(const definition of mongoReceiptClaimIndexes)await db.collection('_domain_outbox').createIndex(definition.keys,definition.options);
 await pg.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3)',[tenant,sku,'Synthetic SKU']);
 await pg.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,$2,'warehouse')",[tenant,location]);
 await db.collection('purchase_orders').insertOne({id:1,po_no:'PO-PB',status:'Released',warehouse:location,vendor:'Synthetic',line_items:[{sku_code:sku,qty:5}]});
 await db.collection('generic_records').insertOne({id:1,module:'location',location_code:location,location_name:location,status:'Active'});
 const unsafeTenant='unsafe-balance-fixture',unsafeSku=randomUUID(),unsafeLocation=randomUUID();
 await pg.query("INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,'UNSAFE-FIXTURE','Synthetic unsafe balance')",[unsafeSku,unsafeTenant]);
 await pg.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'UNSAFE-WH','warehouse')",[unsafeLocation,unsafeTenant]);
 await pg.query('INSERT INTO ci_inventory_balance(tenant_id,master_sku_id,location_id,on_hand) VALUES($1,$2,$3,$4)',[unsafeTenant,unsafeSku,unsafeLocation,'9007199254740993']);
 await assert.rejects(()=>applyInventoryEvent({tenantId:unsafeTenant,masterSkuId:unsafeSku,locationId:unsafeLocation,eventKey:'unsafe-reduction',eventType:'adjustment',source:'owned-fixture',delta_on_hand:-2}),error=>error.status===409);
 assert.equal((await pg.query('SELECT on_hand::text FROM ci_inventory_balance WHERE tenant_id=$1',[unsafeTenant])).rows[0].on_hand,'9007199254740993');
 assert.equal((await pg.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1',[unsafeTenant])).rows[0].count,'0');
 const body={action:'confirm',poNo:'PO-PB',warehouse:location,requestId:'phase-b-receipt-1',invoiceNo:'SYNTHETIC',lines:[{skuCode:sku,rcvdUOMQty:2}]};
 const ledgerIdentity={tenantId:tenant,masterSkuId:(await pg.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1',[tenant])).rows[0].id,
   locationId:(await pg.query('SELECT id FROM ci_location WHERE tenant_id=$1',[tenant])).rows[0].id,eventKey:'invalid-ledger-delta',eventType:'count',source:'owned-input-fixture'};
 for(const column of ['on_hand','reserved_order','reserved_cart','damaged','quarantined','safety_stock']){
   for(const value of [true,[1],null])await assert.rejects(()=>applyInventoryEvent({...ledgerIdentity,[`delta_${column}`]:value}),TypeError);
 }
 for(const [handler,quantityField] of [[inbound,'rcvdUOMQty'],[realtime,'rcvdQty']]){
   const base={...body,inboundType:'With PO'};
   for(const id of [true,[1],1.5])assert.equal((await call(handler,{...base,id})).code,400);
   for(const quantity of [true,[1],' '])assert.equal((await call(handler,{...base,lines:[{skuCode:sku,[quantityField]:quantity}]})).code,400);
   assert.equal((await call(handler,{...base,lines:[null]})).code,400);
   assert.equal((await call(handler,{...base,lines:[{skuCode:sku,[quantityField]:Number.MAX_SAFE_INTEGER},{skuCode:sku,[quantityField]:1}]})).code,400);
 }
 assert.equal(await db.collection('grn').countDocuments(),0,'Rejected inputs must not create Mongo receipts');
 assert.equal(await db.collection('_domain_outbox').countDocuments(),0,'Rejected inputs must not stage durable commands');
 assert.deepEqual(await state(),{events:[],onHand:0},'Rejected inputs must not change authoritative stock');
 for(const limit of [0,-1,101,1.5,'10',true,null])await assert.rejects(()=>runReceiptBridgeBatch(limit),error=>error.code==='RECEIPT_BATCH_INVALID');
 const staging={fields:{status:'Pending'},requestId:'bounded-history-probe',fingerprint:'fixture',inboundNo:'PROBE',poNo:'PO-PB',locationCode:location,lines:[{skuCode:sku,quantity:1}],source:'wms_inbound_create_edit'};
 for(const quantities of [[true],[Number.MAX_SAFE_INTEGER,1]]){
  await db.collection('grn').insertMany(quantities.map((quantity,index)=>({id:90000+index,po_no:'PO-PB',status:'Confirmed',fixture_history:true,lines:[{skuCode:sku,rcvdQty:quantity}]})));
  await assert.rejects(()=>stageReceiptCommand(staging),error=>error.status===400);
  assert.equal(await db.collection('_domain_outbox').countDocuments(),0);
  assert.equal((await db.collection('purchase_orders').findOne({id:1})).receipt_authorization_version,undefined,'Rejected history must roll back source PO fencing');
  await db.collection('grn').deleteMany({fixture_history:true});
 }
 await db.collection('grn').insertMany(Array.from({length:10001},(_,index)=>({id:90000+index,po_no:'PO-PB',status:'Confirmed',fixture_history:true,lines:[]})));
 await assert.rejects(()=>stageReceiptCommand(staging),error=>error.code==='DATABASE_RESULT_LIMIT');
 assert.equal(await db.collection('_domain_outbox').countDocuments(),0);
 assert.equal(await db.collection('_receipt_authorization').countDocuments(),0,'Oversized history must roll back authorization creation');
 assert.equal((await db.collection('purchase_orders').findOne({id:1})).receipt_authorization_version,undefined);
 await db.collection('grn').deleteOne({id:100000,fixture_history:true});
 await mongoDomainTransaction(async(transactionDb,session)=>{
  const start=session.timeoutContext.start;
  const records=await readMongoRows(transactionDb.collection('grn'),{fixture_history:true},{session,projection:{lines:1}});
  assert.equal(records.length,10000,'Complete multi-batch session read must succeed at the row boundary');
  assert.equal(session.timeoutContext.start,start,'Cursor must not renew the transaction deadline');
  assert.equal((await readMongoRows(transactionDb.collection('grn'),{fixture_history:true},{session,limit:100})).length,100);
  assert.equal(session.timeoutContext.start,start,'Paged reads must retain the same transaction deadline');
 });
 await db.collection('grn').deleteMany({fixture_history:true});
 const queued=await call(inbound,body);assert.equal(queued.code,202,JSON.stringify(queued.body));
 assert.equal(queued.body.row.central_receipt_status,'pending');
 assert.equal((await state()).events.length,0);
 const original=await db.collection('_domain_outbox').findOne({tenant_id:tenant});assert.ok(original);
 assert.equal((await call(inbound,body)).code,202);
 assert.equal(await db.collection('_domain_outbox').countDocuments(),1);
 // A failed effect cannot persist its receipt or its ledger side effects.
 await assert.rejects(()=>transaction(db=>consumeEvent(db,original.event,'abort-proof',tenant,async()=>{throw Error('synthetic abort')})));
 assert.equal((await pg.query("SELECT count(*)::int n FROM ci_event_receipt WHERE consumer='abort-proof'")).rows[0].n,0);
 const storeUrl=new URL(process.env.INVENTORY_DATABASE_URL);
 await assert.rejects(withPostgresCommitLoss({host:storeUrl.hostname,port:Number(storeUrl.port),user:'postgres',database:storeUrl.pathname.slice(1),connectionTimeoutMillis:1000},async client=>{
   const connect=pg.connect;
   pg.connect=async()=>client;
   try{return await consumeReceiptCommand(original.event);}
   finally{pg.connect=connect;}
 }),error=>error.code==='DATABASE_COMMIT_UNCERTAIN');
 const processed=await consumeReceiptCommand(original.event);assert.equal(processed.duplicate,true);
 const committed=await state();assert.equal(committed.events.length,1);assert.equal(committed.onHand,2);
 assert.equal((await consumeReceiptCommand(original.event)).duplicate,true);
 assert.deepEqual(await state(),committed);
 const result=(await pg.query('SELECT envelope FROM ci_domain_outbox WHERE tenant_id=$1',[tenant])).rows[0].envelope;
 assert.equal((await db.collection('grn').findOne({id:queued.body.row.id})).central_receipt_status,'pending');
 await projectReceiptResult(result);
 assert.equal((await projectReceiptResult(result)).duplicate,true);
 assert.equal((await db.collection('grn').findOne({id:queued.body.row.id})).central_receipt_status,'committed');
 await runReceiptBridgeBatch();
 assert.deepEqual(await state(),committed);
 const expiredToken=randomUUID();
 await db.collection('_domain_outbox').updateOne({_id:original._id},{$set:{status:'processing',attempts:1,claim_token:expiredToken,lease_until:new Date(0)}});
 await pg.query("UPDATE ci_domain_outbox SET status='processing',attempts=1,claim_token=$2,lease_until=to_timestamp(0) WHERE event_id=$1",[result.event_id,expiredToken]);
 await Promise.all([runReceiptBridgeBatch(),runReceiptBridgeBatch()]);
 const recoveredCommand=await db.collection('_domain_outbox').findOne({_id:original._id});
 const recoveredResult=(await pg.query('SELECT status,attempts,claim_token,lease_until FROM ci_domain_outbox WHERE event_id=$1',[result.event_id])).rows[0];
 assert.equal(recoveredCommand.status,'done');assert.equal(recoveredCommand.attempts,2);assert.equal(recoveredCommand.claim_token,undefined);assert.equal(recoveredCommand.lease_until,undefined);
 assert.equal(recoveredResult.status,'done');assert.equal(recoveredResult.attempts,2);assert.equal(recoveredResult.claim_token,null);assert.equal(recoveredResult.lease_until,null);
 assert.deepEqual(await state(),committed,'Expired claim replay must not duplicate stock');
 await db.collection('_domain_outbox').updateOne({_id:original._id},{$set:{status:'processing',attempts:2,claim_token:expiredToken,lease_until:new Date(0)}});
 await pg.query("UPDATE ci_domain_outbox SET status='processing',attempts=2,claim_token=$2,lease_until=to_timestamp(0) WHERE event_id=$1",[result.event_id,expiredToken]);
 await db.collection('_domain_outbox').insertMany(Array.from({length:100},(_,index)=>({_id:`fairness-command-${index}`,tenant_id:tenant,status:'pending',attempts:0,available_at:new Date(0),event:{invalid:true}})));
 const fairnessResults=await pg.query("INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at) SELECT gen_random_uuid(),$1,'{}'::jsonb,'pending',0,now()-interval '1 minute',now()-interval '1 day' FROM generate_series(1,100) RETURNING event_id",[tenant]);
 await runReceiptBridgeBatch(1);await runReceiptBridgeBatch(1);
 assert.equal((await db.collection('_domain_outbox').findOne({_id:original._id})).status,'done','Expired command must not starve behind ready backlog at batch size one');
 assert.equal((await pg.query('SELECT status FROM ci_domain_outbox WHERE event_id=$1',[result.event_id])).rows[0].status,'done','Expired result must not starve behind ready backlog at batch size one');
 assert.equal(await db.collection('_domain_outbox').countDocuments({_id:{$regex:'^fairness-command-'},status:'held'}),1);
 assert.equal((await pg.query("SELECT count(*)::int AS n FROM ci_domain_outbox WHERE event_id=ANY($1::uuid[]) AND status='held'",[fairnessResults.rows.map(row=>row.event_id)])).rows[0].n,1);
 assert.deepEqual(await state(),committed);
 await db.collection('_domain_outbox').deleteMany({_id:{$regex:'^fairness-command-'}});
 await pg.query('DELETE FROM ci_domain_outbox WHERE event_id=ANY($1::uuid[])',[fairnessResults.rows.map(row=>row.event_id)]);
 const exhaustedResultId=randomUUID();
 await db.collection('_domain_outbox').insertOne({_id:'!!exhausted-command',tenant_id:tenant,status:'processing',attempts:8,claim_token:expiredToken,lease_until:new Date(0),event:original.event});
 await pg.query("INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,claim_token,lease_until) VALUES($1,$2,$3,'processing',8,$4,to_timestamp(0))",[exhaustedResultId,tenant,result,expiredToken]);
 await runReceiptBridgeBatch();
 assert.equal((await db.collection('_domain_outbox').findOne({_id:'!!exhausted-command'})).status,'dead');
 assert.equal((await pg.query('SELECT status FROM ci_domain_outbox WHERE event_id=$1',[exhaustedResultId])).rows[0].status,'dead');
 assert.deepEqual(await state(),committed);
 assert.equal((await call(inbound,body)).code,200);
 const changed=structuredClone(original.event);changed.payload.lines[0].quantity=3;changed.payload_digest=digest(changed.payload);
 await assert.rejects(()=>consumeReceiptCommand(changed),error=>error.code==='EVENT_CONFLICT');
 const wrongOrder=envelope({tenantId:tenant,type:'inbound.receipt.requested.v1',key:original.event.aggregate.key,sequence:3,payload:original.event.payload});
 await assert.rejects(()=>consumeReceiptCommand(wrongOrder),error=>error.code==='EVENT_SEQUENCE');
 assert.deepEqual(await state(),committed);
 // The second API uses the same durable handoff and respects cumulative PO limits.
 const second={action:'confirm',inboundType:'With PO',poNo:'PO-PB',warehouse:location,requestId:'phase-b-receipt-2',lines:[{skuCode:sku,rcvdQty:3}]};
 const queued2=await call(realtime,second);assert.equal(queued2.code,202,JSON.stringify(queued2.body));
 const poisonCommand=structuredClone(original.event);poisonCommand.event_id=randomUUID();poisonCommand.payload.authorization.legacy_received[sku]=-1;poisonCommand.payload_digest=digest(poisonCommand.payload);
 await assert.rejects(()=>consumeReceiptCommand(poisonCommand),error=>error.code==='EVENT_INVALID');
 await db.collection('_domain_outbox').insertOne({_id:'!!poison-command',tenant_id:tenant,event:poisonCommand,status:'pending',attempts:0,available_at:new Date(0)});
 const poisonResult=structuredClone(result);poisonResult.event_id=randomUUID();poisonResult.payload.event_ids=[];poisonResult.payload_digest=digest(poisonResult.payload);
 await pg.query('INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope) VALUES($1,$2,$3)',[poisonResult.event_id,tenant,poisonResult]);
 await Promise.all([runReceiptBridgeBatch(),runReceiptBridgeBatch()]);
 assert.equal((await state()).onHand,5);
 assert.equal((await state()).events.length,2,'Racing bridge runners must post the second receipt once');
 const poisonCommandState=await db.collection('_domain_outbox').findOne({_id:'!!poison-command'});
 assert.equal(poisonCommandState.status,'held');assert.equal(poisonCommandState.attempts,1,'Two runners must not double-count the same failed command attempt');
 const poisonResultState=(await pg.query('SELECT status,attempts FROM ci_domain_outbox WHERE event_id=$1',[poisonResult.event_id])).rows[0];
 assert.equal(poisonResultState.status,'held');assert.equal(poisonResultState.attempts,1,'Two runners must not double-count the same failed result attempt');
 assert.equal((await db.collection('grn').findOne({id:queued2.body.row.id})).central_receipt_status,'committed','Poison rows must not stop valid projection');
 const heldCommand=await db.collection('_domain_outbox').findOne({_id:'!!poison-command'});
 const heldResult=(await pg.query('SELECT attempts FROM ci_domain_outbox WHERE event_id=$1',[poisonResult.event_id])).rows[0];
 await runReceiptBridgeBatch();
 assert.equal((await db.collection('_domain_outbox').findOne({_id:'!!poison-command'})).attempts,heldCommand.attempts);
 assert.equal((await pg.query('SELECT attempts FROM ci_domain_outbox WHERE event_id=$1',[poisonResult.event_id])).rows[0].attempts,heldResult.attempts);
 await db.collection('purchase_orders').insertOne({id:2,po_no:'PO-PB-CRASH',status:'Released',warehouse:location,vendor:'Synthetic',line_items:[{sku_code:sku,qty:2}]});
 const crashRequestId='phase-b-crash-receipt';
 const crashQueued=await call(inbound,{...body,poNo:'PO-PB-CRASH',requestId:crashRequestId,lines:[{skuCode:sku,rcvdUOMQty:2}]});
 assert.equal(crashQueued.code,202,JSON.stringify(crashQueued.body));
 const childEnv={PATH: testBinaryPath(), DMILLS_SKIP_DOTENV: 'true',LANG:'C',TMPDIR:process.env.TMPDIR,NODE_ENV:'test',
  MONGODB_DB:process.env.MONGODB_DB,MONGODB_URI:process.env.MONGODB_URI,
  INVENTORY_DATABASE_URL:process.env.INVENTORY_DATABASE_URL,PGUSER:'postgres',DMILLS_REQUIRE_PERSISTENCE:'true',
  NODE_OPTIONS:process.env.NODE_OPTIONS,INVENTORY_ALLOWED_TENANT_ID:tenant};
 const child=spawn(process.execPath,['scripts/phase-b-receipt-crash-child.mjs',crashRequestId],{env:childEnv,stdio:['ignore','ignore','ignore','ipc']});
 const crashed=await new Promise((resolve,reject)=>{
  let committed=false;const timer=setTimeout(()=>reject(new Error('Synthetic post-commit crash timed out')),15000);
  child.on('message',message=>{if(message==='postgres_committed')committed=true});
  child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({committed,code,signal})});
  child.once('error',reject);
 });
 assert.equal(crashed.committed,true);assert.equal(crashed.signal,'SIGKILL');
 assert.equal((await db.collection('grn').findOne({id:crashQueued.body.row.id})).central_receipt_status,'pending');
 assert.equal((await state()).onHand,7);
 await runReceiptBridgeBatch();
 assert.equal((await db.collection('grn').findOne({id:crashQueued.body.row.id})).central_receipt_status,'committed');
 assert.equal((await state()).onHand,7,'Restart and replay must not post stock twice');
 assert.equal((await db.collection('grn').findOne({id:queued2.body.row.id})).central_receipt_status,'committed');
 const excess=await call(inbound,{...body,requestId:'phase-b-receipt-3',lines:[{skuCode:sku,rcvdUOMQty:1}]});
 assert.equal(excess.code,409);
 assert.equal((await state()).onHand,7);
 await db.collection('purchase_orders').insertOne({id:3,po_no:'PO-PB-PENDING-CAP',status:'Released',warehouse:location,vendor:'Synthetic',line_items:[{sku_code:sku,qty:5}]});
 const reservedCreate={...body,poNo:'PO-PB-PENDING-CAP',requestId:'phase-b-pending-create',lines:[{skuCode:sku,rcvdUOMQty:4}]};
 const reservedRealtime={...second,poNo:'PO-PB-PENDING-CAP',requestId:'phase-b-pending-realtime',lines:[{skuCode:sku,rcvdQty:2}]};
 const competing=await Promise.all([call(inbound,reservedCreate),call(realtime,reservedRealtime)]);
 assert.deepEqual(competing.map(result=>result.code).sort(),[202,409],'Concurrent inbound routes must reserve PO remaining quantity before returning queued');
 const accepted=competing.find(result=>result.code===202),acceptedRequest=accepted.body.row.centralRequestId;
 assert.equal(await db.collection('_domain_outbox').countDocuments({_id:JSON.stringify([tenant,acceptedRequest])}),1);
 assert.equal(await db.collection('_domain_outbox').countDocuments({_id:{$in:[JSON.stringify([tenant,'phase-b-pending-create']),JSON.stringify([tenant,'phase-b-pending-realtime'])]}}),1);
 const beforeReservedCommit=(await state()).onHand;
 await runReceiptBridgeBatch();
 assert.equal((await state()).onHand,beforeReservedCommit+Number(accepted.body.row.lines[0].rcvdUOMQty||accepted.body.row.lines[0].rcvdQty));
 const rejectedRequest=acceptedRequest==='phase-b-pending-create'?'phase-b-pending-realtime':'phase-b-pending-create';
 assert.equal(await db.collection('_domain_outbox').countDocuments({_id:JSON.stringify([tenant,rejectedRequest])}),0,'A competing over-capacity request must not be staged for eventual DLQ/hold');
 console.log('PASS: atomic request, duplicate/conflict/gap, post-commit SIGKILL recovery, replay, two-route PO limit and concurrent pending-capacity admission on fresh _test stores.');
}finally{await mongo.close();await closeDataStore();await pg.end();}
