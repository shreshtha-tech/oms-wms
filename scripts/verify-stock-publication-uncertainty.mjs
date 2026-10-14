import assert from 'node:assert/strict';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { sealCredential } from '../inventory/credentials.js';
import { publishStockTask, runInventoryTaskBatch, reconcileShopifyStock, reconcileWooUncertainStock, reconcileAmazonUncertainStock } from '../inventory/workers.js';
import express from 'express';
import { centralInventoryApi } from '../inventory/central-api.js';

const url=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Use an owned loopback _test database');
process.env.INVENTORY_CREDENTIAL_KEY='0'.repeat(64);
process.env.INVENTORY_ALLOWED_TENANT_ID='publication-fixture';
await migrateInventory();
const db=inventoryPool(),tenant='publication-fixture';
const app=express();app.use((req,_res,next)=>{req.inventoryTenantId=tenant;next();});app.use('/central',centralInventoryApi);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const publicationStatus=async(scope='attention')=>{
 const response=await fetch(`http://127.0.0.1:${server.address().port}/central/publication-status?scope=${scope}`);
 assert.equal(response.status,200);return response.json();
};
try {
 const sku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'FIXTURE-SKU','Fixture') RETURNING id",[tenant])).rows[0].id;
 const location=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'FIXTURE-WH','warehouse') RETURNING id",[tenant])).rows[0].id;
 const sealed=sealCredential({accessToken:'fixture-token'});
 const account=(await db.query(`INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,connection_state,verified_at,encrypted_credentials,credential_iv,credential_tag)
   VALUES($1,'shopify','fixture-publication.myshopify.com','active','verified',now(),$2,$3,$4) RETURNING id`,[tenant,sealed.encrypted,sealed.iv,sealed.tag])).rows[0].id;
 const mapping=(await db.query(`INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active)
   VALUES($1,$2,$3,$4,'FIXTURE-SKU','gid://shopify/InventoryItem/1','gid://shopify/Location/1',true) RETURNING id`,[tenant,account,sku,location])).rows[0].id;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:sku,locationId:location,eventKey:'fixture-opening',eventType:'count',source:'fixture',delta_on_hand:22});
 let remote=20,mutations=0,loseResponse=true;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body);
  if(body.query.startsWith('query'))return{ok:true,status:200,json:async()=>({data:{inventoryItem:{inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1'},quantities:[{name:'available',quantity:remote}]}]}}}})};
  mutations++;remote=body.variables.input.quantities[0].quantity;
  if(loseResponse)throw new Error('fixture response lost after provider accepted quantity');
  return{ok:true,status:200,json:async()=>({data:{inventorySetQuantities:{userErrors:[]}}})};
 };
 const stock=async()=>(await db.query('SELECT * FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,mapping])).rows[0];
 const task=async()=>(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' ORDER BY id DESC LIMIT 1",[tenant,mapping])).rows[0];
 assert.equal(await runInventoryTaskBatch(1,{fetcher}),1);
 assert.equal(remote,22);assert.equal(mutations,1);
 assert.equal((await task()).status,'held');assert.ok((await task()).remote_attempt_started_at);
 assert.equal((await task()).publication_state,'UNKNOWN_REMOTE_STATE');
 assert.equal((await task()).provider_platform,'shopify');assert.equal((await task()).external_sku,'FIXTURE-SKU');
 assert.equal((await task()).internal_sku_id,sku);assert.equal((await task()).internal_location_id,location);
 assert.equal(Number((await task()).pack_size),1);assert.equal((await task()).source_event_id,(await task()).payload.eventId);
 assert.equal(Number((await task()).expected_quantity),22);assert.ok((await task()).remote_request_id);
 assert.equal((await stock()).publish_state,'unknown_remote');
 const heldView=await publicationStatus();assert.equal(heldView.total,1);
 assert.equal(heldView.rows[0].publish_state,'unknown_remote');assert.equal(heldView.rows[0].task_status,'held');
 assert.equal(Number(heldView.rows[0].remote_target_quantity),22);
 assert.equal(heldView.rows[0].publication_state,'UNKNOWN_REMOTE_STATE');assert.equal(heldView.rows[0].source_event_id,(await task()).payload.eventId);
 assert.equal(heldView.rows[0].external_sku,'FIXTURE-SKU');assert.equal(Number(heldView.rows[0].pack_size),1);
 assert.equal(await runInventoryTaskBatch(1,{fetcher}),0,'Unknown remote state must not resend');
 assert.equal(mutations,1);
 const resolved=await reconcileShopifyStock(tenant,{fetcher});
 assert.equal(resolved.checked,1);assert.equal(resolved.mismatched,0);
 assert.equal((await task()).status,'done');assert.equal((await task()).publication_state,'RECONCILED');assert.equal(Number((await task()).readback_quantity),22);
 assert.equal((await task()).acknowledged_at,null,'A dropped response must not be reported as acknowledged');assert.equal((await stock()).publish_state,'confirmed');
 assert.equal(Number((await stock()).readback_quantity),22);
 const confirmedView=await publicationStatus('all');assert.equal(confirmedView.total,1);
 assert.equal(Number(confirmedView.rows[0].readback_quantity),22);
 assert.equal(mutations,1,'Readback resolution must not resend the mutation');
 loseResponse=false;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:sku,locationId:location,eventKey:'fixture-new-count',eventType:'count',source:'fixture',delta_on_hand:1});
 assert.equal(await runInventoryTaskBatch(1,{fetcher}),1);
 assert.equal(remote,23);assert.equal(mutations,2);assert.equal((await task()).status,'done');
 assert.equal((await stock()).publish_state,'confirmed');assert.equal(Number((await stock()).readback_quantity),23);
 await applyInventoryEvent({tenantId:tenant,masterSkuId:sku,locationId:location,eventKey:'fixture-crash',eventType:'count',source:'fixture',delta_on_hand:1});
 const crashTask=await task();
 await db.query(`UPDATE ci_outbox SET status='processing',attempts=1,lease_until=now()-interval '1 second',
   remote_attempt_started_at=now()-interval '1 minute',remote_target_quantity=24 WHERE tenant_id=$1 AND id=$2`,[tenant,crashTask.id]);
 assert.equal(await runInventoryTaskBatch(1,{fetcher}),0);
 assert.equal((await task()).status,'held');assert.equal((await stock()).publish_state,'unknown_remote');
 assert.equal(mutations,2,'Expired remote attempt must be held without another write');
 remote=21;
 const mismatch=await reconcileShopifyStock(tenant,{fetcher});
 assert.equal(mismatch.checked,0);assert.equal((await task()).status,'held');assert.equal((await task()).publication_state,'MISMATCH');
 assert.equal(Number((await task()).readback_quantity),21);assert.equal((await task()).reconciliation_result,'READBACK_MISMATCH');
 assert.equal((await stock()).publish_state,'requires_reconciliation');
 assert.equal(mutations,2,'Mismatch requires review, not a blind retry');
 const wooSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'WOO-FIXTURE','Woo fixture') RETURNING id",[tenant])).rows[0].id;
 const wooSecret=sealCredential({storeUrl:'https://fixture-woo.invalid',consumerKey:'fixture-key',consumerSecret:'fixture-secret'});
 const wooAccount=(await db.query(`INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,connection_state,verified_at,encrypted_credentials,credential_iv,credential_tag)
   VALUES($1,'woocommerce','fixture-woo.invalid','active','verified',now(),$2,$3,$4) RETURNING id`,[tenant,wooSecret.encrypted,wooSecret.iv,wooSecret.tag])).rows[0].id;
 const wooMapping=(await db.query(`INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active)
   VALUES($1,$2,$3,$4,'WOO-FIXTURE','42','store',true) RETURNING id`,[tenant,wooAccount,wooSku,location])).rows[0].id;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:wooSku,locationId:location,eventKey:'woo-opening',eventType:'count',source:'fixture',delta_on_hand:7});
 let wooRemote=5,wooMutations=0,wooLoseResponse=true;
 const wooFetcher=async(_url,options)=>{
   if(options.method==='GET')return {ok:true,status:200,json:async()=>({id:42,sku:'WOO-FIXTURE',manage_stock:true,stock_quantity:wooRemote})};
   wooMutations++;wooRemote=JSON.parse(options.body).stock_quantity;
   if(wooLoseResponse)throw new Error('fixture WooCommerce response lost after acceptance');
   return {ok:true,status:200,json:async()=>({id:42,sku:'WOO-FIXTURE',manage_stock:true,stock_quantity:wooRemote})};
 };
 const wooTask=async()=>(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' ORDER BY id DESC LIMIT 1",[tenant,wooMapping])).rows[0];
 const wooStock=async()=>(await db.query('SELECT * FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,wooMapping])).rows[0];
 assert.equal(await runInventoryTaskBatch(1,{fetcher:wooFetcher}),1);
 assert.equal(wooRemote,7);assert.equal(wooMutations,1);assert.equal((await wooTask()).status,'held');assert.equal((await wooTask()).publication_state,'UNKNOWN_REMOTE_STATE');
 assert.equal((await wooStock()).publish_state,'unknown_remote');
 assert.equal(await runInventoryTaskBatch(1,{fetcher:wooFetcher}),0);assert.equal(wooMutations,1);
 assert.equal((await reconcileWooUncertainStock(tenant,{fetcher:wooFetcher})).resolved,1);
 assert.equal((await wooTask()).status,'done');assert.equal((await wooTask()).publication_state,'RECONCILED');assert.equal(Number((await wooTask()).readback_quantity),7);assert.equal((await wooStock()).publish_state,'confirmed');
 assert.equal(Number((await wooStock()).readback_quantity),7);assert.equal(wooMutations,1);
 wooLoseResponse=false;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:wooSku,locationId:location,eventKey:'woo-count-two',eventType:'count',source:'fixture',delta_on_hand:1});
 assert.equal(await runInventoryTaskBatch(1,{fetcher:wooFetcher}),1);
 assert.equal(wooRemote,8);assert.equal(wooMutations,2);assert.equal((await wooTask()).status,'done');
 await applyInventoryEvent({tenantId:tenant,masterSkuId:wooSku,locationId:location,eventKey:'woo-count-three',eventType:'count',source:'fixture',delta_on_hand:1});
 const wooCrash=await wooTask();
 await db.query(`UPDATE ci_outbox SET status='processing',attempts=1,lease_until=now()-interval '1 second',
   remote_attempt_started_at=now()-interval '1 minute',remote_target_quantity=9 WHERE tenant_id=$1 AND id=$2`,[tenant,wooCrash.id]);
 assert.equal(await runInventoryTaskBatch(1,{fetcher:wooFetcher}),0);
 wooRemote=6;
 const wooMismatch=await reconcileWooUncertainStock(tenant,{fetcher:wooFetcher});
 assert.equal(wooMismatch.requiresReconciliation,1);assert.equal((await wooTask()).status,'held');assert.equal((await wooTask()).publication_state,'MISMATCH');
 assert.equal((await wooStock()).publish_state,'requires_reconciliation');assert.equal(wooMutations,2);
 const amazonSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'AMZ-FIXTURE','Amazon fixture') RETURNING id",[tenant])).rows[0].id;
 const amazonSecret=sealCredential({sellerId:'SELLER-FIXTURE',marketplaceId:'MARKET-FIXTURE',region:'na',clientId:'fixture-client',clientSecret:'fixture-secret',refreshToken:'fixture-refresh'});
 const amazonAccount=(await db.query(`INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,connection_state,verified_at,encrypted_credentials,credential_iv,credential_tag)
   VALUES($1,'amazon','SELLER-FIXTURE','active','verified',now(),$2,$3,$4) RETURNING id`,[tenant,amazonSecret.encrypted,amazonSecret.iv,amazonSecret.tag])).rows[0].id;
 const amazonMapping=(await db.query(`INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active)
   VALUES($1,$2,$3,$4,'AMZ-FIXTURE','AMZ-FIXTURE','DEFAULT',true) RETURNING id`,[tenant,amazonAccount,amazonSku,location])).rows[0].id;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:amazonSku,locationId:location,eventKey:'amazon-opening',eventType:'count',source:'fixture',delta_on_hand:11});
 let amazonRemote=9,amazonMutations=0,amazonLoseResponse=true;
 const amazonFetcher=async(url,options)=>{
   if(url==='https://api.amazon.com/auth/o2/token')return {ok:true,status:200,json:async()=>({access_token:'fixture-token',expires_in:3600})};
   if(options.method==='GET')return {ok:true,status:200,json:async()=>({sku:'AMZ-FIXTURE',fulfillmentAvailability:[{fulfillmentChannelCode:'DEFAULT',quantity:amazonRemote}]})};
   amazonMutations++;amazonRemote=JSON.parse(options.body).patches[0].value[0].quantity;
   if(amazonLoseResponse)throw new Error('fixture Amazon response lost after acceptance');
   return {ok:true,status:200,json:async()=>({status:'ACCEPTED',sku:'AMZ-FIXTURE'})};
 };
 const amazonTask=async()=>(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' ORDER BY id DESC LIMIT 1",[tenant,amazonMapping])).rows[0];
 const amazonStock=async()=>(await db.query('SELECT * FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,amazonMapping])).rows[0];
 assert.equal(await runInventoryTaskBatch(1,{fetcher:amazonFetcher}),1);
 assert.equal(amazonRemote,11);assert.equal(amazonMutations,1);assert.equal((await amazonTask()).status,'held');assert.equal((await amazonTask()).publication_state,'UNKNOWN_REMOTE_STATE');
 assert.equal((await amazonStock()).publish_state,'unknown_remote');
 assert.equal(await runInventoryTaskBatch(1,{fetcher:amazonFetcher}),0);assert.equal(amazonMutations,1);
 assert.equal((await reconcileAmazonUncertainStock(tenant,{fetcher:amazonFetcher})).resolved,1);
 assert.equal((await amazonTask()).status,'done');assert.equal((await amazonTask()).publication_state,'RECONCILED');assert.equal(Number((await amazonTask()).readback_quantity),11);assert.equal((await amazonStock()).publish_state,'confirmed');
 assert.equal(Number((await amazonStock()).readback_quantity),11);assert.equal(amazonMutations,1);
 amazonLoseResponse=false;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:amazonSku,locationId:location,eventKey:'amazon-count-two',eventType:'count',source:'fixture',delta_on_hand:1});
 assert.equal(await runInventoryTaskBatch(1,{fetcher:amazonFetcher}),1);
 assert.equal(amazonRemote,12);assert.equal(amazonMutations,2);assert.equal((await amazonTask()).status,'done');
 assert.equal((await amazonStock()).publish_state,'confirmed');
 await applyInventoryEvent({tenantId:tenant,masterSkuId:amazonSku,locationId:location,eventKey:'amazon-count-three',eventType:'count',source:'fixture',delta_on_hand:1});
 const amazonCrash=await amazonTask();
 await db.query(`UPDATE ci_outbox SET status='processing',attempts=1,lease_until=now()-interval '1 second',
   remote_attempt_started_at=now()-interval '1 minute',remote_target_quantity=13 WHERE tenant_id=$1 AND id=$2`,[tenant,amazonCrash.id]);
 assert.equal(await runInventoryTaskBatch(1,{fetcher:amazonFetcher}),0);
 amazonRemote=8;
 const amazonMismatch=await reconcileAmazonUncertainStock(tenant,{fetcher:amazonFetcher});
 assert.equal(amazonMismatch.requiresReconciliation,1);assert.equal((await amazonTask()).status,'held');assert.equal((await amazonTask()).publication_state,'MISMATCH');
 assert.equal((await amazonStock()).publish_state,'requires_reconciliation');assert.equal(amazonMutations,2);
 const unmappedAmazonSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'AMZ-UNMAPPED','Amazon unmapped fixture') RETURNING id",[tenant])).rows[0].id;
 const unmappedAmazonMapping=(await db.query(`INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active)
   VALUES($1,$2,$3,$4,'AMZ-UNMAPPED','AMZ-UNMAPPED','',true) RETURNING id`,[tenant,amazonAccount,unmappedAmazonSku,location])).rows[0].id;
 const unmappedEvent=await applyInventoryEvent({tenantId:tenant,masterSkuId:unmappedAmazonSku,locationId:location,eventKey:'amazon-unmapped-opening',eventType:'count',source:'fixture',delta_on_hand:3});
 const unmappedTask=(await db.query(`UPDATE ci_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes'
   WHERE tenant_id=$1 AND mapping_id=$2 AND payload->>'eventId'=$3 AND status IN ('pending','retry') RETURNING *`,[tenant,unmappedAmazonMapping,unmappedEvent.eventId])).rows[0];
 assert.ok(unmappedTask);
 await assert.rejects(()=>publishStockTask(unmappedTask,{fetcher:amazonFetcher}),/no approved fulfillment channel code/);
 assert.equal(amazonMutations,2,'Missing Amazon fulfillment-channel mapping must not mutate provider stock');
 const ackSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'ACK-FIXTURE','Acknowledgement fixture') RETURNING id",[tenant])).rows[0].id;
 const ackMapping=(await db.query(`INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active)
   VALUES($1,$2,$3,$4,'ACK-FIXTURE','gid://shopify/InventoryItem/2','gid://shopify/Location/1',true) RETURNING id`,[tenant,account,ackSku,location])).rows[0].id;
 await applyInventoryEvent({tenantId:tenant,masterSkuId:ackSku,locationId:location,eventKey:'ack-opening',eventType:'count',source:'fixture',delta_on_hand:4});
 let ackRemote=0,ackMutations=0,failAcknowledgedReadback=true;
 const ackFetcher=async(_url,options)=>{
   const body=JSON.parse(options.body);
   if(body.query.startsWith('query')){
     if(ackMutations&&failAcknowledgedReadback)throw new Error('fixture readback unavailable after provider acknowledgement');
     const id=body.variables.id;
     return{ok:true,status:200,json:async()=>({data:{inventoryItem:{inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1'},quantities:[{name:'available',quantity:id.endsWith('/2')?ackRemote:remote}]}]}}}})};
   }
   ackMutations++;ackRemote=body.variables.input.quantities[0].quantity;
   return{ok:true,status:200,json:async()=>({data:{inventorySetQuantities:{userErrors:[],inventoryAdjustmentGroup:{createdAt:'2026-10-08T12:00:00.000Z'}}}})};
 };
 assert.equal(await runInventoryTaskBatch(1,{fetcher:ackFetcher}),1);
 const ackTask=async()=>(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' ORDER BY id DESC LIMIT 1",[tenant,ackMapping])).rows[0];
 assert.equal((await ackTask()).status,'held');assert.equal((await ackTask()).publication_state,'READBACK_PENDING');
 assert.ok((await ackTask()).acknowledged_at);assert.equal((await ackTask()).provider_response_reference,'2026-10-08T12:00:00.000Z');
 assert.equal((await ackTask()).readback_quantity,null);
 const ackStock=async()=>(await db.query('SELECT * FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,ackMapping])).rows[0];
 assert.equal((await ackStock()).publish_state,'readback_pending');
 failAcknowledgedReadback=false;
 await reconcileShopifyStock(tenant,{fetcher:ackFetcher});
 assert.equal((await ackTask()).status,'done');assert.equal((await ackTask()).publication_state,'RECONCILED');
 assert.equal((await ackTask()).reconciliation_result,'MATCHED_ATTEMPT');assert.equal(Number((await ackTask()).readback_quantity),4);
 assert.equal(ackMutations,1,'Acknowledged write recovery must use readback, not another provider mutation');
 const lockClient=await db.connect();let lockedReads=0;
 try{
   await lockClient.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`stock:${tenant}:${mapping}`]);
   const lockedReconciliation=reconcileShopifyStock(tenant,{fetcher:async(...args)=>{lockedReads++;return fetcher(...args);}});
   await new Promise(resolve=>setTimeout(resolve,100));
   assert.equal(lockedReads,0,'Provider readback must wait while this mapping is locked for a write');
   await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`stock:${tenant}:${mapping}`]);
   await lockedReconciliation;
   assert.ok(lockedReads>0,'Provider readback proceeds after the mapping lock is released');
 }finally{await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`stock:${tenant}:${mapping}`]).catch(()=>{});lockClient.release();}
 console.log('PASS isolated Shopify/WooCommerce/Amazon timeout, readback resolution, crash lease hold, mismatch quarantine, mapping lock and no blind resend');
} finally { await new Promise(resolve=>server.close(resolve));await db.end(); }
