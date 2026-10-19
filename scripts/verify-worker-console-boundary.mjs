import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { format } from 'node:util';
const source=(await readFile(new URL('./inventory-worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const schemaGate=new AsyncFunction('process','inventoryPool',source);
await assert.rejects(schemaGate({env:{INVENTORY_DATABASE_URL:'fixture',INVENTORY_ALLOWED_TENANT_ID:'fixture',INVENTORY_CREDENTIAL_KEY:'a'.repeat(64)}},()=>({query:async()=>({rows:[{outbox:'ci_outbox',event_receipt:'ci_event_receipt',domain_outbox:'ci_domain_outbox',receipt_claim_token:false,receipt_lease_until:false,receipt_claim_index:false,receipt_expired_index:false,sku_projection_outbox:null}]})})),/migrations through 032/);
for(const brokenLogger of [false,true]){
 const listeners=new Map(),logs=[];let tasks=0,ended=false;
 const unsafe=new Error('fixture-private-provider-secret');
 const processDouble={env:{INVENTORY_DATABASE_URL:'fixture',INVENTORY_ALLOWED_TENANT_ID:'fixture',INVENTORY_CREDENTIAL_KEY:'a'.repeat(64)},on:(event,fn)=>listeners.set(event,fn),exit:()=>{}};
 const lease={on:()=>{},query:async()=>({rows:[{acquired:true}]}),release:()=>{}};
 const pool={query:async sql=>{if(sql.includes('to_regclass'))return {rows:[{outbox:'ci_outbox',event_receipt:'ci_event_receipt',domain_outbox:'ci_domain_outbox',receipt_claim_token:true,receipt_lease_until:true,receipt_claim_index:true,receipt_expired_index:true,sku_projection_outbox:'ci_sku_projection_outbox'}]};throw unsafe;},connect:async()=>lease,end:async()=>{ended=true;}};
 const logger={log(...args){if(brokenLogger)throw unsafe;logs.push(format(...args));},error(...args){if(brokenLogger)throw unsafe;logs.push(format(...args));}};
 const fail=async()=>{throw unsafe;};
 const run=new AsyncFunction('process','inventoryPool','runInventoryTaskBatch','reconcileShopifyStock','reconcileWooUncertainStock','reconcileAmazonUncertainStock','observeSellerConnections','runWhatsAppBatch','pollShopifyOrderObservations','runReceiptBridgeBatch','runSkuProjectionBatch','console','setTimeout',source);
 await run(processDouble,()=>pool,async()=>{tasks++;listeners.get('SIGTERM')();throw unsafe;},fail,fail,fail,fail,fail,fail,fail,fail,logger,fn=>{fn();});
 assert.equal(tasks,1,'Logging failure must not prevent the business batch from running');
 assert.equal(ended,true,'Worker must complete orderly pool cleanup');
 assert.equal(logs.join('\n').includes('fixture-private'),false,'Raw provider error must not reach worker console');
}
for(const blocked of ['heartbeat','order','reconciliation','woo','amazon','seller','notification','receipt','projection']){
 const listeners=new Map();let tasks=0,release,blockedCalls=0,leaseReleased=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const operation=async(name,result)=>{if(name===blocked){blockedCalls++;return gate;}return result;};
 const processDouble={env:{INVENTORY_DATABASE_URL:'fixture',INVENTORY_ALLOWED_TENANT_ID:'fixture',INVENTORY_CREDENTIAL_KEY:'a'.repeat(64)},on:(event,fn)=>listeners.set(event,fn),exit:()=>{}};
 const pool={query:async sql=>sql.includes('to_regclass')?{rows:[{outbox:'ci_outbox',event_receipt:'ci_event_receipt',domain_outbox:'ci_domain_outbox',receipt_claim_token:true,receipt_lease_until:true,receipt_claim_index:true,receipt_expired_index:true,sku_projection_outbox:'ci_sku_projection_outbox'}]}:operation('heartbeat',{rows:[]}),connect:async()=>({on:()=>{},query:async()=>({rows:[{acquired:true}]}),release:()=>{leaseReleased=true;}}),end:async()=>{}};
 const run=new AsyncFunction('process','inventoryPool','runInventoryTaskBatch','reconcileShopifyStock','reconcileWooUncertainStock','reconcileAmazonUncertainStock','observeSellerConnections','runWhatsAppBatch','pollShopifyOrderObservations','runReceiptBridgeBatch','runSkuProjectionBatch','console','setTimeout','tasksClock',source.replaceAll('Date.now()','(Date.now()+tasksClock())'));
 const batch=run(processDouble,()=>pool,async()=>{tasks++;if(tasks===3)listeners.get('SIGTERM')();return 1;},()=>operation('reconciliation',{}),()=>operation('woo',{}),()=>operation('amazon',{}),()=>operation('seller',{}),()=>operation('notification',{claimed:0}),()=>operation('order',{accounts:0,errors:[]}),()=>operation('receipt',{claimed:0}),()=>operation('projection',{projected:0}),{log:()=>{},error:()=>{}},fn=>{fn();},()=>tasks*16*60000);
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tasks,3,`Stalled ${blocked} must not prevent subsequent task executions`);
  assert.equal(blockedCalls,1,`Repeated due ${blocked} intervals must not accumulate jobs`);
  if(blocked!=='heartbeat')assert.equal(leaseReleased,false,'Tenant lock must remain owned until scheduled job completes');
 }finally{release({accounts:0,errors:[]});await batch;}
 assert.equal(leaseReleased,true);
}
{
 const listeners=new Map(),logs=[];let tick=0,bridgeCalls=0;
 const processDouble={env:{INVENTORY_DATABASE_URL:'fixture',INVENTORY_ALLOWED_TENANT_ID:'fixture',INVENTORY_CREDENTIAL_KEY:'a'.repeat(64)},on:(event,fn)=>listeners.set(event,fn),exit:()=>{}};
 const pool={query:async sql=>({rows:sql.includes('to_regclass')?[{outbox:'ci_outbox',event_receipt:'ci_event_receipt',domain_outbox:'ci_domain_outbox',receipt_claim_token:true,receipt_lease_until:true,receipt_claim_index:true,receipt_expired_index:true,sku_projection_outbox:'ci_sku_projection_outbox'}]:[]}),connect:async()=>({on:()=>{},query:async()=>({rows:[{acquired:true}]}),release:()=>{}}),end:async()=>{}};
 const virtualNow=()=>[0,1000,2000,31000,32000][Math.min(tick,4)];
 const run=new AsyncFunction('process','inventoryPool','runInventoryTaskBatch','reconcileShopifyStock','reconcileWooUncertainStock','reconcileAmazonUncertainStock','observeSellerConnections','runWhatsAppBatch','pollShopifyOrderObservations','runReceiptBridgeBatch','runSkuProjectionBatch','console','setTimeout','virtualNow',source.replaceAll('Date.now()','virtualNow()'));
 await run(processDouble,()=>pool,async()=>{await new Promise(resolve=>setImmediate(resolve));if(++tick===5)listeners.get('SIGTERM')();return 1;},async()=>({}),async()=>({}),async()=>({}),async()=>({}),async()=>({}),async()=>({accounts:0,errors:[]}),async()=>{if(++bridgeCalls===1)throw Object.assign(new Error('fixture-private-uri'),{code:'DATABASE_UNAVAILABLE'});return {commands:0,results:0};},async()=>({projected:0}),{log:message=>logs.push(message),error:message=>logs.push(message)},fn=>fn(),virtualNow);
 assert.equal(bridgeCalls,3,'MongoDB outage must back off, then resume normal cadence after recovery');
 const bridgeLogs=logs.filter(line=>line.includes('inbound_receipt_bridge')).map(JSON.parse);
 assert.deepEqual(bridgeLogs.map(line=>[line.state,line.reason]),[['DEGRADED','MONGODB_UNAVAILABLE'],['READY',undefined]]);
 assert.equal(logs.join('\n').includes('fixture-private'),false,'Dependency details must stay out of worker logs');
}
console.log('PASS isolated worker loop: safe console and individually stalled scheduled jobs cannot prevent task progression or accumulate duplicate jobs.');
