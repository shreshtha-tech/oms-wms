import '../env.js';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import { spawn } from 'node:child_process';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';
import { sealCredential } from '../inventory/credentials.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { acceptAmazonNotification, acceptShopifyWebhook } from '../inventory/ingress.js';
import { inventoryPublic } from '../inventory/http.js';
import { processInventoryTask, runInventoryTaskBatch, reconcileShopifyStock } from '../inventory/workers.js';
import { runWhatsAppBatch, whatsappPublic } from '../inventory/whatsapp.js';
import { unifiedOrdersApi, recordReturn, recordIncomingOrder } from '../inventory/unified-orders.js';
import { logSyncAttempt, safeAccountDiagnostic } from '../inventory/sync-attempts.js';
import { approveReturnReceipt } from '../inventory/return-service.js';
import { observeSellerConnections } from '../inventory/connection-observation.js';
import { pollShopifyOrderObservations } from '../inventory/shopify-orders.js';
import { transferCentralWmsStock, adjustCentralWmsStock } from '../inventory/wms-operations.js';
import { importMeeshoOrders } from '../inventory/meesho-orders.js';
import { verifyAndSave } from '../inventory/connections.js';
import { closeDataStore } from '../api/mongo.js';

if(!/test|contract/.test(process.env.INVENTORY_DATABASE_URL||''))throw new Error('Use isolated test database');
const tenant=`unified-${randomUUID()}`,secret='fixture-webhook-secret';
process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
await migrateInventory();
const db=inventoryPool();
const account=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status) VALUES($1,'shopify',$2,'active') RETURNING id",[tenant,'fixture.myshopify.com'])).rows[0];
const amazonAccount=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status) VALUES($1,'amazon',$2,'active') RETURNING id",[tenant,'fixture-seller'])).rows[0];
const offlineAccount=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status) VALUES($1,'offline',$2,'active') RETURNING id",[tenant,'fixture-store'])).rows[0];
const wooAccount=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status) VALUES($1,'woocommerce',$2,'active') RETURNING id",[tenant,'fixture-store.example'])).rows[0];
process.env.INVENTORY_CREDENTIAL_KEY='a'.repeat(64);
const wooCredentials=sealCredential({webhookSecret:'fixture-woocommerce-webhook-secret'});
await db.query('UPDATE ci_channel_account SET encrypted_credentials=$2,credential_iv=$3,credential_tag=$4 WHERE tenant_id=$1 AND id=$5',[tenant,wooCredentials.encrypted,wooCredentials.iv,wooCredentials.tag,wooAccount.id]);
const sku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'TEE-M','Fixture tee') RETURNING id",[tenant])).rows[0];
const wooSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'WOO-TEE','Woo fixture tee') RETURNING id",[tenant])).rows[0];
const location=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'MAIN','warehouse') RETURNING id",[tenant])).rows[0];
await applyInventoryEvent({tenantId:tenant,masterSkuId:sku.id,locationId:location.id,eventKey:'opening',eventType:'count',source:'fixture',delta_on_hand:5});
await applyInventoryEvent({tenantId:tenant,masterSkuId:wooSku.id,locationId:location.id,eventKey:'woo-opening',eventType:'count',source:'fixture',delta_on_hand:20});
await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id,active) VALUES($1,$2,$3,'TEE-M','gid://shopify/InventoryItem/1','gid://shopify/Location/1',$4,true)",[tenant,account.id,sku.id,location.id]);
await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id,active) VALUES($1,$2,$3,'TEE-M','ASIN-FIXTURE','',$4,true)",[tenant,amazonAccount.id,sku.id,location.id]);
await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id,active) VALUES($1,$2,$3,'WOO-TEE','PRODUCT-WOO','',$4,true)",[tenant,wooAccount.id,wooSku.id,location.id]);
await db.query("INSERT INTO ci_alert_recipient(tenant_id,name,role,mobile_e164,platforms,consented_at,verified_at) VALUES($1,'Packer','packer','+919999999999',ARRAY['shopify'],now(),now())",[tenant]);
process.env.WHATSAPP_GRAPH_VERSION='v23.0';process.env.WHATSAPP_PHONE_NUMBER_ID='123456789';process.env.WHATSAPP_ACCESS_TOKEN='fixture-access-token';process.env.WHATSAPP_APP_SECRET='fixture-app-secret';process.env.WHATSAPP_VERIFY_TOKEN='fixture-verify';process.env.WHATSAPP_ORDER_TEMPLATE='approved_order_alert';
const messageId=`wamid.${randomUUID()}`;const calls=[];const fakeFetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({messages:[{id:calls.length===1?messageId:`wamid.${randomUUID()}`}]})};};
const raw=Buffer.from(JSON.stringify({id:1001,line_items:[{id:77,sku:'TEE-M',quantity:2,title:'Fixture tee'}],created_at:new Date().toISOString(),shipping_address:{city:'Mumbai',zip:'400001'},current_total_price:'900.00',currency:'INR'}));
const hmac=createHmac('sha256',secret).update(raw).digest('base64');
try{
 const first=await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'delivery-1',rawBody:raw,hmac,secret});
 assert.equal(first.duplicate,false);
 const replay=await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'delivery-1',rawBody:raw,hmac,secret});assert.equal(replay.duplicate,true);
 const immediate=await runWhatsAppBatch(5,fakeFetch);assert.equal(immediate.claimed,1,'A newly received order alerts before stock reservation');assert.equal(calls[0].body.template.components[0].parameters[3].text,'Review order; wait for stock reservation');
 const queued=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress'",[tenant])).rows;
 assert.equal(queued.length,1);
 await db.query("UPDATE ci_outbox SET status='processing',attempts=1,lease_until=now()+interval '2 minutes' WHERE id=$1",[queued[0].id]);
 await processInventoryTask({...queued[0],status:'processing',attempts:1});
 await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[queued[0].id]);
 assert.equal(await runInventoryTaskBatch(1),1,'An expired post-commit worker lease must be reclaimed after a simulated crash before acknowledgement');
 const retriedIngress=(await db.query('SELECT status,attempts FROM ci_outbox WHERE tenant_id=$1 AND id=$2',[tenant,queued[0].id])).rows[0];assert.equal(retriedIngress.status,'done');assert.equal(retriedIngress.attempts,2,'Expired worker lease must increment its delivery attempt');
 const connectionAfterIngress=(await db.query('SELECT connection_state,verified_at FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenant,account.id])).rows[0];
 assert.equal(connectionAfterIngress.connection_state,'not_connected','Internal ingress processing must not claim provider credential verification');
 assert.equal(connectionAfterIngress.verified_at,null,'Internal ingress processing supplies no provider authentication evidence');
 await db.query("UPDATE ci_channel_account SET connection_state='token_expired' WHERE tenant_id=$1 AND id=$2",[tenant,account.id]);
 await logSyncAttempt({tenantId:tenant,accountId:account.id,direction:'inbound',operation:'shopify_ingress'});
 assert.equal((await db.query('SELECT connection_state FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenant,account.id])).rows[0].connection_state,'token_expired','Successful local work must not clear an expired provider credential state');
 await db.query("UPDATE ci_channel_account SET connection_state='verified',verified_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,account.id]);
 await logSyncAttempt({tenantId:tenant,accountId:account.id,direction:'inbound',operation:'shopify_ingress',status:'failed',diagnostic:{message:'Unmapped fixture SKU'}});
 assert.equal((await db.query('SELECT connection_state FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenant,account.id])).rows[0].connection_state,'verified','A business mapping failure must not overwrite explicit provider credential verification');
 assert.equal((await db.query("SELECT count(*) FROM ci_sync_attempt WHERE tenant_id=$1 AND account_id=$2 AND status='failed'",[tenant,account.id])).rows[0].count,'1','Failure must remain visible in the operation audit');
 assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='1001' AND event_type='reserve'",[tenant])).rows[0].count,'1','Post-commit outbox redelivery must not reserve stock twice');
 const balance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0];assert.equal(Number(balance.on_hand),5);assert.equal(Number(balance.reserved_order),2);
 const order=(await db.query('SELECT * FROM ci_unified_order WHERE tenant_id=$1',[tenant])).rows[0];assert.equal(order.external_order_id,'1001');assert.equal(order.city,'Mumbai');
 assert.equal((await db.query('SELECT count(*) FROM ci_order_alert WHERE tenant_id=$1',[tenant])).rows[0].count,'1');
 assert.equal((await db.query("SELECT count(*) FROM ci_order_timeline WHERE tenant_id=$1 AND event_type='stock_reserved'",[tenant])).rows[0].count,'1');
 assert.equal(calls.length,1);assert.equal(calls[0].body.to,'919999999999');
 const alert=(await db.query('SELECT * FROM ci_order_alert WHERE tenant_id=$1',[tenant])).rows[0];assert.equal(alert.status,'accepted');
 const app=express();app.use('/api/inventory-sync',inventoryPublic);app.use('/whatsapp',whatsappPublic);app.use(express.json());app.use('/unified',(req,_res,next)=>{req.inventoryTenantId=tenant;next();},unifiedOrdersApi);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const wooWebhook=(deliveryId,payload,signatureOverride)=>{const body=Buffer.from(JSON.stringify(payload));return fetch(`${base}/api/inventory-sync/woocommerce/${wooAccount.id}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-wc-webhook-topic':'order.updated','x-wc-webhook-delivery-id':deliveryId,'x-wc-webhook-signature':signatureOverride||createHmac('sha256','fixture-woocommerce-webhook-secret').update(body).digest('base64')},body});};
  const wooStaleId=`WOO-STALE-${randomUUID()}`,olderRevision='2026-10-01T11:00:00.000Z',newerRevision='2026-10-01T12:00:00.000Z';
  const wooPayload=(status,revision)=>({id:wooStaleId,status,date_created:'2026-10-01T10:00:00',date_modified_gmt:revision,line_items:[{id:90,sku:'WOO-TEE',quantity:1}]});
  const badWoo=await wooWebhook('woo-bad-signature',wooPayload('processing',olderRevision),'invalid');assert.equal(badWoo.status,401,'WooCommerce webhook must reject an invalid HMAC signature');
  assert.equal((await db.query("SELECT count(*) FROM ci_ingress WHERE tenant_id=$1 AND source=$2",[tenant,`woocommerce:${wooAccount.id}`])).rows[0].count,'0','Invalid WooCommerce signature must not persist ingress');
  assert.equal((await wooWebhook('woo-old',wooPayload('processing',olderRevision))).status,202);
  assert.equal((await wooWebhook('woo-new',wooPayload('cancelled',newerRevision))).status,202);
  const wooQueued=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='woocommerce_ingress' AND payload->'event'->>'id'=$2 ORDER BY id",[tenant,wooStaleId])).rows;
  assert.equal(wooQueued.length,2);
  assert.equal(wooQueued[0].payload.event.providerUpdatedAt,olderRevision,'WooCommerce provider revision must survive HTTP ingress into the worker task');
  assert.deepEqual(await processInventoryTask(wooQueued[0]),{stale:true},'An older queued completion/status task must be ignored after the newer provider snapshot is stored');
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,wooAccount.id,wooStaleId])).rows[0].work_status,'new','A provider cancellation stays pending locally until its inventory transition succeeds');
  await processInventoryTask(wooQueued[1]);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,wooSku.id])).rows[0].on_hand),20,'A stale WooCommerce completion must not deduct stock after a newer cancellation');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference=$2 AND event_type='dispatch'",[tenant,wooStaleId])).rows[0].count,'0');
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,wooAccount.id,wooStaleId])).rows[0].work_status,'cancelled');
  assert.equal((await db.query("SELECT count(*) FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND status='active'",[tenant,`woocommerce:${wooAccount.id}`,wooStaleId])).rows[0].count,'0');
  const statusBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},statuses:[{id:messageId,status:'delivered'}]}}]}]}));
  const signature='sha256='+createHmac('sha256','fixture-app-secret').update(statusBody).digest('hex');
  const status=await fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':signature,'content-type':'application/json'},body:statusBody});assert.equal(status.status,200);
  assert.equal((await db.query('SELECT status FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0].status,'delivered');
  const beforeDeliveryReplay=(await db.query('SELECT status,delivered_at FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0];
  assert.equal((await fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':signature,'content-type':'application/json'},body:statusBody})).status,200);
  assert.deepEqual((await db.query('SELECT status,delivered_at FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0],beforeDeliveryReplay,'Exact callback replay must preserve the first delivery observation timestamp');
  await db.query("UPDATE ci_order_alert SET status='accepted' WHERE id=$1",[alert.id]);
  const callbackLock=await db.connect();let lateCallback;
  try{
   await callbackLock.query('BEGIN');await callbackLock.query("UPDATE ci_order_alert SET status='read' WHERE id=$1",[alert.id]);
   const lateBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},statuses:[{id:messageId,status:'sent'}]}}]}]}));
   lateCallback=fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','fixture-app-secret').update(lateBody).digest('hex'),'content-type':'application/json'},body:lateBody});
   let blocked=false;
   for(let attempt=0;attempt<200&&!blocked;attempt++){
    blocked=(await db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ci_order_alert%' LIMIT 1")).rowCount>0;
    if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.ok(blocked,'The signed callback must reach the actual database lock boundary');
   await callbackLock.query('COMMIT');assert.equal((await lateCallback).status,200);
  }finally{await callbackLock.query('ROLLBACK');callbackLock.release();if(lateCallback)await lateCallback;}
  assert.equal((await db.query('SELECT status FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0].status,'read','A delayed sent callback must not overwrite a concurrently committed read status');
  await db.query("UPDATE ci_order_alert SET status='accepted' WHERE id=$1",[alert.id]);
  const readBody=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},statuses:[{id:messageId,status:'read'}]}}]}]}));
  const sendReadCallback=()=>fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','fixture-app-secret').update(readBody).digest('hex'),'content-type':'application/json'},body:readBody});
  await db.query("CREATE FUNCTION codexqa_fail_callback_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='whatsapp_read' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_callback_audit_failure BEFORE INSERT ON ci_order_timeline FOR EACH ROW EXECUTE FUNCTION codexqa_fail_callback_audit()');
  try{
   assert.ok((await sendReadCallback()).status>=400,'A callback must not acknowledge an uncommitted status/audit transition');
   assert.equal((await db.query('SELECT status FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0].status,'accepted','Timeline failure must roll back the callback status write');
  }finally{await db.query('DROP TRIGGER codexqa_callback_audit_failure ON ci_order_timeline');await db.query('DROP FUNCTION codexqa_fail_callback_audit()');}
  assert.equal((await sendReadCallback()).status,200);
  assert.equal((await db.query('SELECT status FROM ci_order_alert WHERE id=$1',[alert.id])).rows[0].status,'read');
  assert.equal((await db.query("SELECT count(*) FROM ci_order_timeline WHERE tenant_id=$1 AND order_id=$2 AND event_type='whatsapp_read'",[tenant,order.id])).rows[0].count,'1','Retry commits the callback and one audit event together');
  const orders=await(await fetch(base+'/unified/orders')).json();assert.equal(orders.length,2);assert.equal(orders.find(item=>item.external_order_id===String(order.external_order_id)).items[0].sku,'TEE-M');
  const packedTooSoon=await fetch(base+`/unified/orders/${order.id}/status`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'packed'})});assert.equal(packedTooSoon.status,409);
  const sellerAction=await fetch(base+`/unified/orders/${order.id}/status`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'accepted'})});assert.equal(sellerAction.status,409,'Seller fulfillment must not advance without provider authorization');
  const shopCancelId='1003',shopCancelLine={id:79,sku:'TEE-M',quantity:1,title:'Fixture tee'};
  const shopCancelEvent=(updatedAt,cancelledAt=null)=>({id:Number(shopCancelId),updated_at:updatedAt,...(cancelledAt?{cancelled_at:cancelledAt}:{}),line_items:[shopCancelLine]});
  const shopCancelCreate=Buffer.from(JSON.stringify(shopCancelEvent('2026-10-01T10:00:00.000Z')));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'shop-cancel-create',rawBody:shopCancelCreate,hmac:createHmac('sha256',secret).update(shopCancelCreate).digest('base64'),secret});
  const shopCreateTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress' AND payload->'event'->>'id'=$2",[tenant,shopCancelId])).rows[0];await processInventoryTask(shopCreateTask);
  const shopCancelPayload=Buffer.from(JSON.stringify(shopCancelEvent('2026-10-01T10:01:00.000Z','2026-10-01T10:01:00.000Z')));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/cancelled',messageId:'shop-cancel-event',rawBody:shopCancelPayload,hmac:createHmac('sha256',secret).update(shopCancelPayload).digest('base64'),secret});
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,account.id,shopCancelId])).rows[0].work_status,'new','A cancellation webhook must not mark local work canceled before reservation release succeeds');
  const shopCancelTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress' AND payload->>'topic'='orders/cancelled' AND payload->'event'->>'id'=$2",[tenant,shopCancelId])).rows[0];await processInventoryTask(shopCancelTask);
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,account.id,shopCancelId])).rows[0].work_status,'cancelled','A fully applied Shopify cancellation updates local work status');
  assert.equal((await db.query("SELECT count(*) FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND status='active'",[tenant,`shopify:${account.id}`,shopCancelId])).rows[0].count,'0');
  const offlineOrderId=randomUUID(),offlineExternalId=`OFF-${randomUUID()}`;
  await db.query("INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,$3,'offline',$4,'open','packed')",[offlineOrderId,tenant,offlineAccount.id,offlineExternalId]);
  await db.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity) VALUES($1,$2,'OFF-L1','TEE-M',1)",[tenant,offlineOrderId]);
  await applyInventoryEvent({tenantId:tenant,masterSkuId:sku.id,locationId:location.id,eventKey:`${offlineExternalId}:reserve`,eventType:'reserve',source:`offline:${offlineAccount.id}`,delta_reserved_order:1,reservation:{action:'reserve',orderId:offlineExternalId,lineId:'OFF-L1',quantity:1}});
  await db.query("INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type) VALUES($1,$2,$3,'stock_reserved')",[tenant,offlineOrderId,`${offlineExternalId}:reserved`]);
  const offlineDispatch=await fetch(base+`/unified/orders/${offlineOrderId}/status`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'dispatched'})});assert.equal(offlineDispatch.status,501,'Offline dispatch must remain blocked until physical handover evidence exists');
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND id=$2',[tenant,offlineOrderId])).rows[0].work_status,'packed');
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].on_hand),5,'Blocked offline dispatch must not deduct on-hand stock');
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),3,'Blocked offline dispatch must preserve the active reservation');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND source=$2 AND external_reference=$3 AND event_type='dispatch'",[tenant,`offline:${offlineAccount.id}`,offlineExternalId])).rows[0].count,'0');
  // This synthetic account explicitly grants provider dispatch authority; other accounts remain fail-closed.
  await transaction(async tx=>{
    const grant=await tx.query(`UPDATE ci_channel_account SET settings=settings||'{"providerAuthoritative":true}'::jsonb,provider_authority_revision=provider_authority_revision+1 WHERE tenant_id=$1 AND id=$2 AND provider_authority_revision=0 RETURNING provider_authority_revision`,[tenant,wooAccount.id]);
    assert.equal(grant.rowCount,1);
    await tx.query('INSERT INTO ci_provider_authority_audit(tenant_id,account_id,previous_value,new_value,revision,actor,reason) VALUES($1,$2,false,true,$3,$4,$5)',[tenant,wooAccount.id,grant.rows[0].provider_authority_revision,'fixture-operator','Synthetic WooCommerce dispatch lifecycle authorization']);
  });
  const wooOrderId=randomUUID(),wooExternalId=`WOO-${randomUUID()}`;
  await db.query("INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,$3,'woocommerce',$4,'processing','new')",[wooOrderId,tenant,wooAccount.id,wooExternalId]);
  await db.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity) VALUES($1,$2,'WOO-L1','WOO-TEE',1)",[tenant,wooOrderId]);
  const wooTask=(status,externalId=wooExternalId,providerUpdatedAt=null,lineId='WOO-L1')=>({tenant_id:tenant,account_id:wooAccount.id,task_type:'woocommerce_ingress',payload:{topic:'order.updated',event:{id:externalId,status,providerUpdatedAt,line_items:[{id:lineId,sku:'WOO-TEE',quantity:1}]}}});
  await processInventoryTask(wooTask('completed'));
  await processInventoryTask(wooTask('processing'));
  await processInventoryTask(wooTask('completed'));
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,wooSku.id])).rows[0].on_hand),19,'WooCommerce completed should consume the mapped physical unit once');
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,wooSku.id])).rows[0].reserved_order),0,'A delayed processing event must not recreate a reservation after completion');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference=$2 AND event_type='dispatch'",[tenant,wooExternalId])).rows[0].count,'1','Out-of-order and duplicate WooCommerce completion must not dispatch twice');
  assert.equal((await db.query("SELECT terminal_status FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id='WOO-L1'",[tenant,`woocommerce:${wooAccount.id}`,wooExternalId])).rows[0].terminal_status,'shipped');
  const emptyExternalId=`WOO-EMPTY-${randomUUID()}`;
  await db.query("INSERT INTO ci_unified_order(tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,'woocommerce',$3,'completed','new')",[tenant,wooAccount.id,emptyExternalId]);
  await assert.rejects(()=>processInventoryTask({tenant_id:tenant,account_id:wooAccount.id,task_type:'woocommerce_ingress',payload:{topic:'order.updated',event:{id:emptyExternalId,status:'completed',providerUpdatedAt:null,line_items:[]}}}),/no physical lines/);
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,wooAccount.id,emptyExternalId])).rows[0].work_status,'new','An empty WooCommerce completion must not mark an order dispatched');
  for(let index=0;index<8;index++){
   const raceOrderId=randomUUID(),raceExternalId=`WOO-RACE-${index}-${randomUUID()}`;
   await db.query("INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,$3,'woocommerce',$4,'processing','new')",[raceOrderId,tenant,wooAccount.id,raceExternalId]);
   await db.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity) VALUES($1,$2,'WOO-RACE-L1','WOO-TEE',1)",[tenant,raceOrderId]);
   const before=Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,wooSku.id])).rows[0].on_hand);
   const outcomes=await Promise.allSettled([processInventoryTask(wooTask('completed',raceExternalId,null,'WOO-RACE-L1')),processInventoryTask(wooTask('cancelled',raceExternalId,null,'WOO-RACE-L1'))]);
   assert.ok(outcomes.some(result=>result.status==='fulfilled'),'At least the winning terminal event must commit');
   const terminal=(await db.query("SELECT terminal_status FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id='WOO-RACE-L1'",[tenant,`woocommerce:${wooAccount.id}`,raceExternalId])).rows[0]?.terminal_status;
   const after=Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,wooSku.id])).rows[0].on_hand);
   const dispatchCount=(await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference=$2 AND event_type='dispatch'",[tenant,raceExternalId])).rows[0].count;
   assert.ok(['canceled','shipped'].includes(terminal),`Concurrent WooCommerce terminal events must leave a terminal line state: ${JSON.stringify(outcomes.map(result=>result.status==='rejected'?String(result.reason):'committed'))}`);
   assert.equal(after,terminal==='shipped'?before-1:before,'Concurrent terminal status and ledger stock must agree');
   assert.equal(dispatchCount,terminal==='shipped'?'1':'0','Concurrent cancellation cannot leave an unrepresented dispatch event');
   assert.equal((await db.query("SELECT count(*) FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND status='active'",[tenant,`woocommerce:${wooAccount.id}`,raceExternalId])).rows[0].count,'0');
   if(terminal==='canceled')assert.notEqual((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND id=$2',[tenant,raceOrderId])).rows[0].work_status,'dispatched','A completion after cancellation must not mark the order dispatched');
  }
  await transaction(async tx=>{
    const grant=await tx.query(`UPDATE ci_channel_account SET settings=settings||'{"providerAuthoritative":true}'::jsonb,provider_authority_revision=provider_authority_revision+1 WHERE tenant_id=$1 AND id=$2 AND provider_authority_revision=0 RETURNING provider_authority_revision`,[tenant,amazonAccount.id]);
    assert.equal(grant.rowCount,1);
    await tx.query('INSERT INTO ci_provider_authority_audit(tenant_id,account_id,previous_value,new_value,revision,actor,reason) VALUES($1,$2,false,true,$3,$4,$5)',[tenant,amazonAccount.id,grant.rows[0].provider_authority_revision,'fixture-operator','Synthetic Amazon unified-order lifecycle authorization']);
  });
  let amazonRevision=0;const amazonEvent=(messageId,status,orderId='AMZ-2001',notificationLevel='OrderLevel',quantityShipped=null,line={})=>{const item={OrderItemId:'AMZ-L1',SellerSKU:'TEE-M',Quantity:1,...line};if(['Shipped','PartiallyShipped'].includes(status))item.QuantityShipped=quantityShipped??item.Quantity;return {NotificationType:'ORDER_CHANGE',NotificationMetadata:{NotificationId:messageId},Payload:{OrderChangeNotification:{NotificationLevel:notificationLevel,SellerId:'fixture-seller',AmazonOrderId:orderId,OrderChangeType:'OrderStatusChange',OrderChangeTrigger:{TimeOfOrderChange:new Date(Date.UTC(2026,0,1,0,0,amazonRevision++)).toISOString(),ChangeReason:'fixture'},Summary:{FulfillmentType:'MFN',OrderStatus:status,OrderItems:[item]}}}};};
  await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:amazonEvent('amazon-unshipped','Unshipped')});
  const amazonReserve=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-unshipped'",[tenant])).rows[0];
  await processInventoryTask(amazonReserve);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),4);
  await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:amazonEvent('amazon-shipped','Shipped')});
  const amazonDispatch=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-shipped'",[tenant])).rows[0];
  await processInventoryTask(amazonDispatch);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].on_hand),4);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),3);
  const cancelAfterShip=amazonEvent('amazon-cancel-after-ship','Canceled');await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:cancelAfterShip});const cancelAfterShipTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-cancel-after-ship'",[tenant])).rows[0];await assert.rejects(()=>processInventoryTask(cancelAfterShipTask),/Conflicting Amazon terminal status/);
  const shippedOrder=(await db.query('SELECT provider_status,work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,amazonAccount.id,'AMZ-2001'])).rows[0];assert.equal(shippedOrder.provider_status,'Canceled');assert.equal(shippedOrder.work_status,'dispatched','A provider cancellation after shipment must not overwrite successfully dispatched local work');
  const itemOrderId='AMZ-ITEM-LEVEL-1',itemUnshipped=amazonEvent('amazon-item-unshipped','Unshipped',itemOrderId);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:itemUnshipped});const itemReserve=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-item-unshipped'",[tenant])).rows[0];await processInventoryTask(itemReserve);
  const itemShipped=amazonEvent('amazon-item-shipped','Shipped',itemOrderId,'OrderItemLevel');await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:itemShipped});const itemDispatch=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-item-shipped'",[tenant])).rows[0];await assert.rejects(()=>processInventoryTask(itemDispatch),/OrderLevel notification snapshot/);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].on_hand),4,'An item-level Amazon shipped notification must not deduct the full order');assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),4,'Rejected Amazon item-level shipment must preserve its reservation');
  const partialShipped=amazonEvent('amazon-partial-shipped','Shipped',itemOrderId,'OrderLevel',0);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:partialShipped});const partialDispatch=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-partial-shipped'",[tenant])).rows[0];await assert.rejects(()=>processInventoryTask(partialDispatch),/partial item quantity/);assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),4,'A partial shipped quantity must preserve its full reservation for reconciliation');
  const itemCanceled=amazonEvent('amazon-item-cancelled','Canceled',itemOrderId);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:itemCanceled});const itemCancel=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-item-cancelled'",[tenant])).rows[0];await processInventoryTask(itemCancel);assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),3,'Cancellation of the blocked item-level shipment releases only its active reservation');
  const partialSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'AMZ-PARTIAL-TEE','Partial shipment fixture') RETURNING id",[tenant])).rows[0];
  await applyInventoryEvent({tenantId:tenant,masterSkuId:partialSku.id,locationId:location.id,eventKey:'amazon-partial-opening',eventType:'count',source:'fixture',delta_on_hand:5});
  await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id,active) VALUES($1,$2,$3,'AMZ-PARTIAL-TEE','ASIN-PARTIAL','',$4,true)",[tenant,amazonAccount.id,partialSku.id,location.id]);
  const partialOrderId='AMZ-PARTIAL-1',partialLine={OrderItemId:'AMZ-PARTIAL-L1',SellerSKU:'AMZ-PARTIAL-TEE',Quantity:2};
  const partialUnshipped=amazonEvent('amazon-partial-order','Unshipped',partialOrderId,'OrderLevel',null,partialLine);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:partialUnshipped});const partialReserve=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-partial-order'",[tenant])).rows[0];await processInventoryTask(partialReserve);
  const partiallyShipped=amazonEvent('amazon-partial-status','PartiallyShipped',partialOrderId,'OrderLevel',1,partialLine);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:partiallyShipped});const partialStatusTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-partial-status'",[tenant])).rows[0];assert.deepEqual(await processInventoryTask(partialStatusTask),{reconciliationRequired:true});
  const partialCancel=amazonEvent('amazon-partial-cancel','Canceled',partialOrderId,'OrderLevel',null,partialLine);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:partialCancel});const partialCancelTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-partial-cancel'",[tenant])).rows[0];await assert.rejects(()=>processInventoryTask(partialCancelTask),/after partial shipment requires quantity and package reconciliation/);
  assert.equal((await db.query('SELECT work_status FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenant,amazonAccount.id,partialOrderId])).rows[0].work_status,'partially_shipped','An unreconciled partial-shipment cancellation must preserve the observed partial-shipment state');
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,partialSku.id])).rows[0].on_hand),5,'Cancellation after partial shipment must not release or deduct stock without package reconciliation');assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,partialSku.id])).rows[0].reserved_order),2);
  const fullyShipped=amazonEvent('amazon-partial-final-shipped','Shipped',partialOrderId,'OrderLevel',2,partialLine);await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:fullyShipped});const fullShipTask=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='amazon-partial-final-shipped'",[tenant])).rows[0];await assert.rejects(()=>processInventoryTask(fullShipTask),/after partial shipment requires quantity and package reconciliation/);assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,partialSku.id])).rows[0].on_hand),5);assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,partialSku.id])).rows[0].reserved_order),2);
  const returnId=await transaction(tx=>recordReturn(tx,{tenantId:tenant,accountId:amazonAccount.id,platform:'amazon',event:{id:'AMZ-RET-1',order_id:'AMZ-2001',status:'refunded'}}));
  const options=await(await fetch(base+`/unified/returns/${returnId}/options`)).json();assert.equal(options.items[0].sku,'TEE-M');
  const receipt={requestId:randomUUID(),masterSkuId:sku.id,locationId:location.id,quantity:1};
  const returned=await fetch(base+`/unified/returns/${returnId}/approve-receipt`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(receipt)});assert.equal(returned.status,200);
  const duplicateReceipt=await fetch(base+`/unified/returns/${returnId}/approve-receipt`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(receipt)});assert.equal((await duplicateReceipt.json()).duplicate,true);
  const excessReceipt=await fetch(base+`/unified/returns/${returnId}/approve-receipt`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...receipt,requestId:randomUUID(),quantity:1})});assert.equal(excessReceipt.status,409);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].on_hand),5);
  const oversell=Buffer.from(JSON.stringify({id:1002,line_items:[{id:78,sku:'TEE-M',quantity:10}],created_at:new Date().toISOString()}));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'delivery-oversell',rawBody:oversell,hmac:createHmac('sha256',secret).update(oversell).digest('base64'),secret});
  const blocked=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress' AND payload->'event'->>'id'='1002'",[tenant])).rows[0];
  await assert.rejects(()=>processInventoryTask(blocked),/Insufficient or invalid stock/);
  assert.equal((await runWhatsAppBatch(5,fakeFetch)).claimed,1,'An unreserved order still sends the immediate receipt alert');
  assert.equal(calls.length,2);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,sku.id])).rows[0].reserved_order),3,'The failed oversell must leave the existing Shopify and offline reservations unchanged');
  const packSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'PACK-3','Three-unit fixture pack') RETURNING id",[tenant])).rows[0];
  await applyInventoryEvent({tenantId:tenant,masterSkuId:packSku.id,locationId:location.id,eventKey:'pack-opening',eventType:'count',source:'fixture',delta_on_hand:20});
  for(const packAccount of [account,amazonAccount])await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,internal_location_id,pack_size,active) VALUES($1,$2,$3,'PACK-3','fixture-pack',$4,3,true)",[tenant,packAccount.id,packSku.id,location.id]);
  const packShopEvent={id:4001,line_items:[{id:40011,sku:'PACK-3',quantity:2}]};
  const packShopRaw=Buffer.from(JSON.stringify(packShopEvent));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'pack-shop-create',rawBody:packShopRaw,hmac:createHmac('sha256',secret).update(packShopRaw).digest('base64'),secret});
  const packShopQueued=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress' AND payload->'event'->>'id'='4001'",[tenant])).rows[0];
  await processInventoryTask(packShopQueued);
  const packAmazon=amazonEvent('pack-amazon-create','Unshipped','AMZ-PACK','OrderLevel',null,{OrderItemId:'PACK-AMZ-L1',SellerSKU:'PACK-3',Quantity:2});
  await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:packAmazon});
  const packAmazonQueued=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='pack-amazon-create'",[tenant])).rows[0];
  await processInventoryTask(packAmazonQueued);
  const packedReservations=(await db.query('SELECT source,quantity FROM ci_reservation WHERE tenant_id=$1 AND master_sku_id=$2 ORDER BY source',[tenant,packSku.id])).rows;
  assert.equal(packedReservations.length,2);
  assert.deepEqual(packedReservations.map(row=>Number(row.quantity)),[6,6],`Two provider packs must reserve six physical units each: ${JSON.stringify(packedReservations)}`);
  await processInventoryTask(packShopQueued);await processInventoryTask(packAmazonQueued);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,packSku.id])).rows[0].reserved_order),12,'Pack reserve replay must not add units');
  await assert.rejects(()=>processInventoryTask({...packShopQueued,payload:{...packShopQueued.payload,event:{...packShopEvent,line_items:[{...packShopEvent.line_items[0],quantity:Number.MAX_SAFE_INTEGER}]}}}),/positive safe integer in physical units/);
  await db.query('UPDATE ci_channel_mapping SET pack_size=4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,account.id,packSku.id]);
  await assert.rejects(()=>processInventoryTask({...packShopQueued,payload:{...packShopQueued.payload,topic:'orders/cancelled'}}),/Active reservation does not match/,'Changed pack mapping must not silently release a different physical quantity');
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,packSku.id])).rows[0].reserved_order),12);
  await db.query('UPDATE ci_channel_mapping SET pack_size=3 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,account.id,packSku.id]);
  const alternateLocation=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'PACK-OTHER','warehouse') RETURNING id",[tenant])).rows[0];
  await applyInventoryEvent({tenantId:tenant,masterSkuId:packSku.id,locationId:alternateLocation.id,eventKey:'pack-other-opening',eventType:'count',source:'fixture',delta_on_hand:20});
  await applyInventoryEvent({tenantId:tenant,masterSkuId:packSku.id,locationId:alternateLocation.id,eventKey:'pack-other-reserve',eventType:'reserve',source:'fixture',delta_reserved_order:6,reservation:{action:'reserve',orderId:'unrelated-order',lineId:'unrelated-line',quantity:6}});
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,account.id,packSku.id,alternateLocation.id]);
  const remappedCancel=await Promise.allSettled([processInventoryTask({...packShopQueued,payload:{...packShopQueued.payload,topic:'orders/cancelled'}})]);
  const remappedBalances=(await db.query('SELECT location_id,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 ORDER BY location_id',[tenant,packSku.id])).rows;
  assert.equal(remappedCancel[0].status,'rejected',`Remapped cancellation must reject; current balances: ${JSON.stringify(remappedBalances)}`);
  assert.match(String(remappedCancel[0].reason),/reservation.*(identity|mapping)/i);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,alternateLocation.id])).rows[0].reserved_order),6);
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,account.id,packSku.id,location.id]);
  await processInventoryTask({...packShopQueued,payload:{...packShopQueued.payload,topic:'orders/cancelled'}});
  await processInventoryTask({...packShopQueued,payload:{...packShopQueued.payload,topic:'orders/cancelled'}});
  const packShipped=amazonEvent('pack-amazon-shipped','Shipped','AMZ-PACK','OrderLevel',2,{OrderItemId:'PACK-AMZ-L1',SellerSKU:'PACK-3',Quantity:2});
  await acceptAmazonNotification({tenantId:tenant,accountId:amazonAccount.id,notification:packShipped});
  const packDispatch=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND task_type='amazon_ingress' AND payload->'NotificationMetadata'->>'NotificationId'='pack-amazon-shipped'",[tenant])).rows[0];
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,amazonAccount.id,packSku.id,alternateLocation.id]);
  await assert.rejects(()=>processInventoryTask(packDispatch),/reservation.*(identity|mapping)/i,'Amazon dispatch must not consume another location\'s reserved balance');
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,alternateLocation.id])).rows[0].reserved_order),6);
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,amazonAccount.id,packSku.id,location.id]);
  await processInventoryTask(packDispatch);await processInventoryTask(packDispatch);
  const packBalance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,location.id])).rows[0];
  assert.equal(Number(packBalance.on_hand),14);assert.equal(Number(packBalance.reserved_order),0,'Cancellation releases six units and shipment consumes six units exactly once');
  await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,internal_location_id,pack_size,active) VALUES($1,$2,$3,'PACK-3','fixture-woo-pack',$4,3,true)",[tenant,wooAccount.id,packSku.id,location.id]);
  const wooPackOrder=(await db.query("INSERT INTO ci_unified_order(tenant_id,account_id,platform,external_order_id,provider_status) VALUES($1,$2,'woocommerce','WOO-PACK','processing') RETURNING id",[tenant,wooAccount.id])).rows[0];
  await db.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity) VALUES($1,$2,'WOO-PACK-L1','PACK-3',2)",[tenant,wooPackOrder.id]);
  const wooPackTask=status=>({tenant_id:tenant,account_id:wooAccount.id,task_type:'woocommerce_ingress',payload:{topic:'order.updated',event:{id:'WOO-PACK',status,line_items:[{id:'WOO-PACK-L1',sku:'PACK-3',quantity:2}]}}});
  await processInventoryTask(wooPackTask('processing'));
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,location.id])).rows[0].reserved_order),6);
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,wooAccount.id,packSku.id,alternateLocation.id]);
  for(const status of ['completed','cancelled'])await assert.rejects(()=>processInventoryTask(wooPackTask(status)),/reservation.*(identity|mapping)/i);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,alternateLocation.id])).rows[0].reserved_order),6);
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4 WHERE tenant_id=$1 AND account_id=$2 AND master_sku_id=$3',[tenant,wooAccount.id,packSku.id,location.id]);
  await applyInventoryEvent({tenantId:tenant,masterSkuId:wooSku.id,locationId:location.id,eventKey:'unrelated-sku-reserve',eventType:'reserve',source:'fixture',delta_reserved_order:6,reservation:{action:'reserve',orderId:'unrelated-sku-order',lineId:'unrelated-sku-line',quantity:6}});
  await db.query("UPDATE ci_channel_mapping SET master_sku_id=$3 WHERE tenant_id=$1 AND account_id=$2 AND external_sku='PACK-3'",[tenant,wooAccount.id,wooSku.id]);
  await assert.rejects(()=>processInventoryTask(wooPackTask('completed')),/reservation.*(identity|mapping)/i,'SKU remapping must not consume an unrelated SKU reservation');
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,wooSku.id,location.id])).rows[0].reserved_order),6);
  await db.query("UPDATE ci_channel_mapping SET master_sku_id=$3 WHERE tenant_id=$1 AND account_id=$2 AND external_sku='PACK-3'",[tenant,wooAccount.id,packSku.id]);
  await processInventoryTask(wooPackTask('completed'));await processInventoryTask(wooPackTask('completed'));
  const wooPackBalance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,location.id])).rows[0];
  assert.equal(Number(wooPackBalance.on_hand),8);assert.equal(Number(wooPackBalance.reserved_order),0);
  for(const snapshot of [
   {platform:'shopify',accountId:account.id,orderId:'4001',lineId:'40011',sku:'PACK-3',quantity:2,topic:'orders/updated',event:{id:4001,line_items:[{id:40011,sku:'TEE-M',quantity:9}]}},
   {platform:'woocommerce',accountId:wooAccount.id,orderId:'WOO-PACK',lineId:'WOO-PACK-L1',sku:'PACK-3',quantity:2,topic:'order.updated',event:{id:'WOO-PACK',status:'completed',line_items:[{id:'WOO-PACK-L1',sku:'WOO-TEE',quantity:9}]}},
   {platform:'woocommerce',accountId:wooAccount.id,orderId:wooStaleId,lineId:'90',sku:'WOO-TEE',quantity:1,topic:'order.updated',event:{id:wooStaleId,status:'cancelled',date_modified_gmt:'2026-10-01T13:00:00.000Z',line_items:[{id:90,sku:'PACK-3',quantity:9}]}}
  ]){
   await transaction(tx=>recordIncomingOrder(tx,{tenantId:tenant,accountId:snapshot.accountId,platform:snapshot.platform,event:snapshot.event,topic:snapshot.topic}));
   const protectedLine=(await db.query('SELECT seller_sku,quantity FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3) AND external_line_id=$4',[tenant,snapshot.accountId,snapshot.orderId,snapshot.lineId])).rows[0];
   assert.deepEqual(protectedLine,{seller_sku:snapshot.sku,quantity:snapshot.quantity},'Provider updates must not overwrite stock-bound or terminal order line identity');
   assert.ok((await db.query("SELECT 1 FROM ci_order_timeline WHERE tenant_id=$1 AND order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3) AND event_type='line_change_requires_review'",[tenant,snapshot.accountId,snapshot.orderId])).rowCount>0,'Rejected snapshot line changes must retain a visible review marker');
  }
  const packReturnId=await transaction(tx=>recordReturn(tx,{tenantId:tenant,accountId:amazonAccount.id,platform:'amazon',event:{id:'AMZ-PACK-RETURN',order_id:'AMZ-PACK',status:'refunded'}}));
  const packReceipt={tenantId:tenant,returnId:packReturnId,requestId:randomUUID(),masterSkuId:packSku.id,locationId:location.id,quantity:2};
  const concurrentReceipts=await Promise.allSettled([approveReturnReceipt(packReceipt),approveReturnReceipt(packReceipt)]);
  assert.equal(concurrentReceipts.filter(result=>result.status==='fulfilled').length,2,`Concurrent exact return replay must return the same committed result: ${JSON.stringify(concurrentReceipts.map(result=>result.status==='rejected'?{error:result.reason.code||result.reason.message}:result.value))}`);
  assert.equal(concurrentReceipts.filter(result=>result.status==='fulfilled'&&result.value.duplicate===true).length,1);
  assert.equal(concurrentReceipts[0].value.receiptId,concurrentReceipts[1].value.receiptId);assert.equal(concurrentReceipts[0].value.eventId,concurrentReceipts[1].value.eventId);
  assert.equal((await db.query('SELECT count(*) FROM ci_return_receipt WHERE tenant_id=$1 AND request_id=$2',[tenant,packReceipt.requestId])).rows[0].count,'1');
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,location.id])).rows[0].on_hand),10);
  await assert.rejects(()=>approveReturnReceipt({...packReceipt,quantity:1}),error=>error.status===409,'Changed return replay must reject without restocking');
  const secondPackReturn=await transaction(tx=>recordReturn(tx,{tenantId:tenant,accountId:amazonAccount.id,platform:'amazon',event:{id:'AMZ-PACK-RETURN-2',order_id:'AMZ-PACK',status:'refunded'}}));
  const competingReturns=await Promise.allSettled([approveReturnReceipt({...packReceipt,requestId:randomUUID(),quantity:3}),approveReturnReceipt({...packReceipt,returnId:secondPackReturn,requestId:randomUUID(),quantity:3})]);
  assert.equal(competingReturns.filter(result=>result.status==='fulfilled').length,1,'Concurrent return cases must share the source order dispatch cap');
  assert.equal(competingReturns.find(result=>result.status==='rejected').reason.status,409);
  assert.equal(Number((await db.query('SELECT sum(quantity) AS quantity FROM ci_return_receipt WHERE tenant_id=$1 AND return_id=ANY($2::uuid[])',[tenant,[packReturnId,secondPackReturn]])).rows[0].quantity),5);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,packSku.id,location.id])).rows[0].on_hand),13,'Two units plus one three-unit return restore five, bounded by six dispatched');
  // Isolate a poison task from the remaining fixture tasks without deleting them.
  await db.query("UPDATE ci_outbox SET available_at=now()+interval '1 day' WHERE tenant_id=$1 AND status IN ('pending','retry')",[tenant]);
  const foreignTenant=`other-${randomUUID()}`;
  const foreignTask=(await db.query("INSERT INTO ci_outbox(tenant_id,task_type,payload,status,attempts,lease_until) VALUES($1,'unsupported_fixture',$2,'processing',3,now()-interval '1 second') RETURNING *",[foreignTenant,JSON.stringify({case:randomUUID()})])).rows[0];
  assert.equal(await runInventoryTaskBatch(1),0,'A tenant worker must not reclaim another tenant\'s expired task');
  assert.deepEqual((await db.query('SELECT * FROM ci_outbox WHERE id=$1',[foreignTask.id])).rows[0],foreignTask,'Foreign task state, attempts and lease must remain untouched');
  await db.query("UPDATE ci_outbox SET status='pending',attempts=0,lease_until=NULL WHERE id=$1",[foreignTask.id]);
  assert.equal(await runInventoryTaskBatch(1),0,'Tenant worker must not claim a foreign pending task');
  assert.equal((await db.query('SELECT attempts FROM ci_outbox WHERE id=$1',[foreignTask.id])).rows[0].attempts,0);
  const foreignAccount=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id) VALUES($1,'shopify','foreign-fixture.myshopify.com') RETURNING id",[foreignTenant])).rows[0];
  const foreignOrder=(await db.query("INSERT INTO ci_unified_order(tenant_id,account_id,platform,external_order_id,provider_status) VALUES($1,$2,'shopify','foreign-order','open') RETURNING id",[foreignTenant,foreignAccount.id])).rows[0];
  const foreignRecipient=(await db.query("INSERT INTO ci_alert_recipient(tenant_id,name,role,mobile_e164,consented_at,verified_at) VALUES($1,'Foreign fixture','packer','+919999999998',now(),now()) RETURNING id",[foreignTenant])).rows[0];
  await db.query("INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type,status,claimed_at) VALUES($1,$2,$3,'new_order','pending',NULL),($1,$2,$3,'order_observed','sending',now()-interval '3 minutes')",[foreignTenant,foreignOrder.id,foreignRecipient.id]);
  const foreignAlerts=(await db.query('SELECT * FROM ci_order_alert WHERE tenant_id=$1 ORDER BY id',[foreignTenant])).rows;
  const callsBeforeForeign=calls.length;
  assert.equal((await runWhatsAppBatch(5,fakeFetch)).claimed,0,'Tenant sender must not send another tenant\'s notification');
  assert.equal(calls.length,callsBeforeForeign,'No foreign notification may reach the sender');
  assert.deepEqual((await db.query('SELECT * FROM ci_order_alert WHERE tenant_id=$1 ORDER BY id',[foreignTenant])).rows,foreignAlerts,'Foreign stale alerts must not be changed by this tenant worker');
  await db.query("UPDATE ci_unified_order SET first_seen_at=now()-interval '3 hours' WHERE id=$1",[foreignOrder.id]);
  await runWhatsAppBatch(5,fakeFetch);
  assert.deepEqual((await db.query('SELECT * FROM ci_order_alert WHERE tenant_id=$1 ORDER BY id',[foreignTenant])).rows,foreignAlerts,'Foreign expired alerts must not be failed by this tenant worker');
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  try{
   await assert.rejects(()=>runInventoryTaskBatch(1),/INVENTORY_ALLOWED_TENANT_ID/);
   await assert.rejects(()=>runWhatsAppBatch(5,fakeFetch),/INVENTORY_ALLOWED_TENANT_ID/);
  }finally{process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;}
  await db.query("UPDATE ci_outbox SET status='pending',available_at=now(),attempts=0 WHERE id=$1",[queued[0].id]);
  await db.query("CREATE FUNCTION codexqa_fail_sync_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='success' AND NEW.operation='shopify_ingress' THEN RAISE EXCEPTION 'fixture success audit unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_sync_audit_failure BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_sync_audit()');
  try{
   assert.equal(await runInventoryTaskBatch(1),1);
   assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[queued[0].id])).rows[0].status,'retry','Task acknowledgement must roll back when its success audit cannot persist');
  }finally{await db.query('DROP TRIGGER codexqa_sync_audit_failure ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_sync_audit()');}
  await db.query('UPDATE ci_outbox SET available_at=now() WHERE id=$1',[queued[0].id]);
  assert.equal(await runInventoryTaskBatch(1),1);
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[queued[0].id])).rows[0].status,'done');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='1001' AND event_type='reserve'",[tenant])).rows[0].count,'1','Audit recovery must not duplicate committed stock effects');
  const poison=(await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload) VALUES($1,$2,'unsupported_fixture',$3) RETURNING id",[tenant,wooAccount.id,JSON.stringify({case:randomUUID()})])).rows[0];
  const validKey=process.env.INVENTORY_CREDENTIAL_KEY;
  process.env.INVENTORY_CREDENTIAL_KEY='b'.repeat(64);
  try{
   const withheld=await safeAccountDiagnostic(tenant,wooAccount.id,{message:'Provider response echoed fixture-private-credential',nested:{body:'fixture-private-credential'}});
   assert.equal(JSON.stringify(withheld).includes('fixture-private-credential'),false,'Decryption failure must discard every raw diagnostic field');
   assert.equal(await runInventoryTaskBatch(1),1,'Undecryptable credentials must not break poison-task failure handling');
   let poisonState=(await db.query('SELECT status,attempts,last_error,lease_until FROM ci_outbox WHERE id=$1',[poison.id])).rows[0];
   assert.equal(poisonState.status,'retry');assert.equal(poisonState.attempts,1);assert.equal(poisonState.lease_until,null);
   assert.match(poisonState.last_error,/withheld/i,'Unredactable provider diagnostics must be replaced, never persisted raw');
   for(let execution=2;execution<=8;execution++){
    await db.query('UPDATE ci_outbox SET available_at=now() WHERE id=$1',[poison.id]);
    assert.equal(await runInventoryTaskBatch(1),1);
    poisonState=(await db.query('SELECT status,attempts,lease_until,extract(epoch from (available_at-now())) AS delay FROM ci_outbox WHERE id=$1',[poison.id])).rows[0];
    assert.equal(poisonState.status,execution===8?'dead':'retry');
    assert.equal(poisonState.attempts,execution);assert.equal(poisonState.lease_until,null);
    const expectedDelay=Math.min(3600,2**execution*5);
    assert.ok(Number(poisonState.delay)<=expectedDelay+1 && Number(poisonState.delay)>=expectedDelay/2-2,'Persisted jittered backoff must match the attempt number');
   }
   await db.query('UPDATE ci_outbox SET available_at=now() WHERE id=$1',[poison.id]);
   assert.equal(await runInventoryTaskBatch(1),0,'Dead task cannot execute a ninth time without explicit replay');
   assert.equal((await db.query('SELECT attempts FROM ci_outbox WHERE id=$1',[poison.id])).rows[0].attempts,8);
  }finally{process.env.INVENTORY_CREDENTIAL_KEY=validKey;}
  await db.query("UPDATE ci_outbox SET status='retry',attempts=7,available_at=now() WHERE id=$1",[poison.id]);
  await db.query("CREATE FUNCTION codexqa_fail_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='failed' THEN RAISE EXCEPTION 'fixture retry audit unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_retry_audit_failure BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_retry_audit()');
  try{
   assert.equal(await runInventoryTaskBatch(1),1);
   const interruptedFailure=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[poison.id])).rows[0];
   assert.equal(interruptedFailure.status,'dead');assert.equal(interruptedFailure.attempts,8);assert.equal(interruptedFailure.lease_until,null);
   assert.ok(interruptedFailure.last_error,'Durable failure remains operator-visible despite diagnostic audit outage');
  }finally{await db.query('DROP TRIGGER codexqa_retry_audit_failure ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_retry_audit()');}
  assert.equal(await runInventoryTaskBatch(1),0,'Diagnostic outage cannot permit a ninth execution');
  const recoveredFailure=(await db.query('SELECT status,lease_until FROM ci_outbox WHERE id=$1',[poison.id])).rows[0];assert.equal(recoveredFailure.status,'dead');assert.equal(recoveredFailure.lease_until,null);
  const beforePersistenceFault=(await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 ORDER BY master_sku_id,location_id',[tenant])).rows;
  for(const startingAttempts of [0,7]){
   const interrupted=(await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload,attempts) VALUES($1,$2,'failure_persistence_fixture','{}',$3) RETURNING id",[tenant,wooAccount.id,startingAttempts])).rows[0];
   await db.query("CREATE FUNCTION codexqa_fail_failure_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_type='failure_persistence_fixture' AND NEW.status IN ('retry','dead') THEN RAISE EXCEPTION 'fixture failure state unavailable'; END IF; RETURN NEW; END $$");
   await db.query('CREATE TRIGGER codexqa_failure_state BEFORE UPDATE ON ci_outbox FOR EACH ROW EXECUTE FUNCTION codexqa_fail_failure_state()');
   try{
    await assert.rejects(()=>runInventoryTaskBatch(1),/fixture failure state unavailable/);
    const durable=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[interrupted.id])).rows[0];
    assert.equal(durable.status,'processing');assert.equal(durable.attempts,startingAttempts+1);assert.ok(durable.lease_until);assert.equal(durable.last_error,null);
    assert.equal(await runInventoryTaskBatch(1),0,'Unexpired failed-persistence lease cannot be double claimed');
   }finally{await db.query('DROP TRIGGER codexqa_failure_state ON ci_outbox');await db.query('DROP FUNCTION codexqa_fail_failure_state()');}
   await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[interrupted.id]);
   assert.equal(await runInventoryTaskBatch(1),startingAttempts===7?0:1);
   const recovered=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[interrupted.id])).rows[0];
   assert.equal(recovered.status,startingAttempts===7?'dead':'retry');assert.equal(recovered.attempts,startingAttempts===7?8:2);assert.equal(recovered.lease_until,null);assert.ok(recovered.last_error);
   await db.query("UPDATE ci_outbox SET status='dead' WHERE id=$1",[interrupted.id]);
  }
  assert.deepEqual((await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 ORDER BY master_sku_id,location_id',[tenant])).rows,beforePersistenceFault,'Retry-state persistence failure/recovery cannot alter fixture physical balances');
  for(const priorAttempts of [0,7]){
   const crashTask=(await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload,attempts) VALUES($1,$2,'shopify_ingress',$3,$4) RETURNING id",[tenant,account.id,JSON.stringify({topic:'inventory_levels/update',event:{inventory_item_id:'claim-crash-fixture',location_id:'fixture'}}),priorAttempts])).rows[0];
   const child=spawn(process.execPath,['scripts/fixture-worker-claim-crash.mjs'],{env:process.env,stdio:['ignore','ignore','inherit','ipc']});
   const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
   try{
    await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Worker claim checkpoint timeout')),10000);
     child.once('error',error=>{clearTimeout(timer);reject(error);});
     child.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before crash checkpoint'));});
     child.once('message',message=>{clearTimeout(timer);assert.equal(message.checkpoint,'claimed-before-business-query');resolve();});
    });
    const claimed=(await db.query('SELECT status,attempts,lease_until FROM ci_outbox WHERE id=$1',[crashTask.id])).rows[0];
    assert.equal(claimed.status,'processing');assert.equal(claimed.attempts,priorAttempts+1);assert.ok(claimed.lease_until);
    child.kill('SIGKILL');
    assert.equal((await exited).signal,'SIGKILL');
   }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
   assert.equal(await runInventoryTaskBatch(1),0,'Killed worker lease remains protected until expiry');
   await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[crashTask.id]);
   assert.equal(await runInventoryTaskBatch(1),priorAttempts===7?0:1);
   const recovered=(await db.query('SELECT status,attempts,lease_until FROM ci_outbox WHERE id=$1',[crashTask.id])).rows[0];
   assert.equal(recovered.status,priorAttempts===7?'dead':'retry');assert.equal(recovered.attempts,priorAttempts===7?8:2);assert.equal(recovered.lease_until,null);
   await db.query("UPDATE ci_outbox SET status='dead' WHERE id=$1",[crashTask.id]);
  }
  assert.deepEqual((await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 ORDER BY master_sku_id,location_id',[tenant])).rows,beforePersistenceFault,'Actual worker claim crashes cannot alter fixture physical balances');
  const crashSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'STOCK-CRASH','Fixture crash stock') RETURNING id",[tenant])).rows[0];
  await applyInventoryEvent({tenantId:tenant,masterSkuId:crashSku.id,locationId:location.id,eventKey:'stock-crash-opening',eventType:'count',source:'fixture',delta_on_hand:5});
  await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,internal_location_id,active) VALUES($1,$2,$3,'STOCK-CRASH','fixture-stock-crash',$4,true)",[tenant,account.id,crashSku.id,location.id]);
  const crashEvent={id:'STOCK-COMMIT-CRASH',line_items:[{id:1,sku:'STOCK-CRASH',quantity:2}],created_at:new Date().toISOString()};
  const crashRaw=Buffer.from(JSON.stringify(crashEvent));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/create',messageId:'stock-commit-crash',rawBody:crashRaw,hmac:createHmac('sha256',secret).update(crashRaw).digest('base64'),secret});
  const crashOutbox=(await db.query("SELECT id FROM ci_outbox WHERE tenant_id=$1 AND payload->'event'->>'id'='STOCK-COMMIT-CRASH'",[tenant])).rows[0];
  const stockChild=spawn(process.execPath,['scripts/fixture-worker-claim-crash.mjs'],{env:{...process.env,FIXTURE_CRASH_CHECKPOINT:'stock-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const stockExit=new Promise(resolve=>stockChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Stock commit checkpoint timeout')),10000);
    stockChild.once('error',error=>{clearTimeout(timer);reject(error);});
    stockChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before stock checkpoint'));});
    stockChild.once('message',message=>{clearTimeout(timer);assert.equal(message.checkpoint,'stock-committed-before-ack');resolve();});
   });
   assert.equal((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0].reserved_order,'2');
   stockChild.kill('SIGKILL');assert.equal((await stockExit).signal,'SIGKILL');
  }finally{if(stockChild.exitCode===null&&stockChild.signalCode===null){stockChild.kill('SIGKILL');await stockExit;}}
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'processing');
  await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[crashOutbox.id]);
  assert.equal(await runInventoryTaskBatch(1),1);
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'done');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='STOCK-COMMIT-CRASH' AND event_type='reserve'",[tenant])).rows[0].count,'1');
  const crashBalance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0];
  assert.deepEqual(crashBalance,{on_hand:'5',reserved_order:'2'});
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  {
  const cancelRaw=Buffer.from(JSON.stringify({...crashEvent,cancelled_at:new Date().toISOString()}));
  await acceptShopifyWebhook({tenantId:tenant,accountId:account.id,topic:'orders/cancelled',messageId:'stock-release-crash',rawBody:cancelRaw,hmac:createHmac('sha256',secret).update(cancelRaw).digest('base64'),secret});
  const crashOutbox=(await db.query("SELECT id FROM ci_outbox WHERE tenant_id=$1 AND payload->'event'->>'id'='STOCK-COMMIT-CRASH' AND payload->>'topic'='orders/cancelled'",[tenant])).rows[0];
  const stockChild=spawn(process.execPath,['scripts/fixture-worker-claim-crash.mjs'],{env:{...process.env,FIXTURE_CRASH_CHECKPOINT:'stock-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const stockExit=new Promise(resolve=>stockChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Stock commit checkpoint timeout')),10000);
    stockChild.once('error',error=>{clearTimeout(timer);reject(error);});
    stockChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before stock checkpoint'));});
    stockChild.once('message',message=>{clearTimeout(timer);assert.equal(message.checkpoint,'stock-committed-before-ack');resolve();});
   });
   assert.equal((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0].reserved_order,'0');
   stockChild.kill('SIGKILL');assert.equal((await stockExit).signal,'SIGKILL');
  }finally{if(stockChild.exitCode===null&&stockChild.signalCode===null){stockChild.kill('SIGKILL');await stockExit;}}
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'processing');
  await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[crashOutbox.id]);
  assert.equal(await runInventoryTaskBatch(1),1);
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'done');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='STOCK-COMMIT-CRASH' AND event_type='cancel'",[tenant])).rows[0].count,'1');
  const crashBalance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0];
  assert.deepEqual(crashBalance,{on_hand:'5',reserved_order:'0'});
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  }
  {
  await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,internal_location_id,active) VALUES($1,$2,$3,'STOCK-CRASH','fixture-dispatch-crash',$4,true)",[tenant,wooAccount.id,crashSku.id,location.id]);
  const dispatchPayload=status=>({id:'DISPATCH-COMMIT-CRASH',status,line_items:[{id:1,sku:'STOCK-CRASH',quantity:2}],date_created:'2026-10-01T10:00:00',date_modified_gmt:status==='completed'?'2026-10-02T10:00:00':'2026-10-01T11:00:00'});
  assert.equal((await wooWebhook('dispatch-crash-reserve',dispatchPayload('processing'))).status,202);
  assert.equal(await runInventoryTaskBatch(1),1);
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  assert.equal((await wooWebhook('dispatch-crash-complete',dispatchPayload('completed'))).status,202);
  const crashOutbox=(await db.query("SELECT id FROM ci_outbox WHERE tenant_id=$1 AND payload->'event'->>'id'='DISPATCH-COMMIT-CRASH' AND payload->'event'->>'status'='completed'",[tenant])).rows[0];
  const stockChild=spawn(process.execPath,['scripts/fixture-worker-claim-crash.mjs'],{env:{...process.env,FIXTURE_CRASH_CHECKPOINT:'stock-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const stockExit=new Promise(resolve=>stockChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Stock commit checkpoint timeout')),10000);
    stockChild.once('error',error=>{clearTimeout(timer);reject(error);});
    stockChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before stock checkpoint'));});
    stockChild.once('message',message=>{clearTimeout(timer);assert.equal(message.checkpoint,'stock-committed-before-ack');resolve();});
   });
   assert.equal((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0].reserved_order,'0');
   stockChild.kill('SIGKILL');assert.equal((await stockExit).signal,'SIGKILL');
  }finally{if(stockChild.exitCode===null&&stockChild.signalCode===null){stockChild.kill('SIGKILL');await stockExit;}}
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'processing');
  await db.query("UPDATE ci_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[crashOutbox.id]);
  assert.equal(await runInventoryTaskBatch(1),1);
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[crashOutbox.id])).rows[0].status,'done');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='DISPATCH-COMMIT-CRASH' AND event_type='dispatch'",[tenant])).rows[0].count,'1');
  const crashBalance=(await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0];
  assert.deepEqual(crashBalance,{on_hand:'3',reserved_order:'0'});
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  }
  const crashReturnId=await transaction(tx=>recordReturn(tx,{tenantId:tenant,accountId:wooAccount.id,platform:'woocommerce',event:{id:'RETURN-COMMIT-CRASH',order_id:'DISPATCH-COMMIT-CRASH',status:'refunded'}}));
  const crashReceipt={tenantId:tenant,returnId:crashReturnId,requestId:randomUUID(),masterSkuId:crashSku.id,locationId:location.id,quantity:2};
  {
  const returnChild=spawn(process.execPath,['scripts/fixture-return-commit-crash.mjs'],{env:{...process.env,FIXTURE_RETURN_CHECKPOINT:'before-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const returnExit=new Promise(resolve=>returnChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Return commit checkpoint timeout')),10000);
    returnChild.once('error',error=>{clearTimeout(timer);reject(error);});
    returnChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Return process exited before checkpoint'));});
    returnChild.on('message',message=>{if(message.checkpoint==='ready'){returnChild.send(crashReceipt);}else{clearTimeout(timer);assert.equal(message.checkpoint,'return-before-commit');resolve();}});
   });
   assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0].on_hand,'3');
   returnChild.kill('SIGKILL');assert.equal((await returnExit).signal,'SIGKILL');
  }finally{if(returnChild.exitCode===null&&returnChild.signalCode===null){returnChild.kill('SIGKILL');await returnExit;}}
  assert.equal((await db.query('SELECT count(*) FROM ci_return_receipt WHERE tenant_id=$1 AND request_id=$2',[tenant,crashReceipt.requestId])).rows[0].count,'0');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='RETURN-COMMIT-CRASH' AND event_type='return_qc_approved'",[tenant])).rows[0].count,'0');
  assert.deepEqual((await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0],{on_hand:'3',reserved_order:'0'});
  }
  const returnChild=spawn(process.execPath,['scripts/fixture-return-commit-crash.mjs'],{env:process.env,stdio:['ignore','ignore','inherit','ipc']});
  const returnExit=new Promise(resolve=>returnChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Return commit checkpoint timeout')),10000);
    returnChild.once('error',error=>{clearTimeout(timer);reject(error);});
    returnChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Return process exited before checkpoint'));});
    returnChild.on('message',message=>{if(message.checkpoint==='ready'){returnChild.send(crashReceipt);}else{clearTimeout(timer);assert.equal(message.checkpoint,'return-committed');resolve();}});
   });
   assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0].on_hand,'5');
   returnChild.kill('SIGKILL');assert.equal((await returnExit).signal,'SIGKILL');
  }finally{if(returnChild.exitCode===null&&returnChild.signalCode===null){returnChild.kill('SIGKILL');await returnExit;}}
  assert.equal((await approveReturnReceipt(crashReceipt)).duplicate,true);
  assert.equal((await db.query('SELECT count(*) FROM ci_return_receipt WHERE tenant_id=$1 AND request_id=$2',[tenant,crashReceipt.requestId])).rows[0].count,'1');
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND external_reference='RETURN-COMMIT-CRASH' AND event_type='return_qc_approved'",[tenant])).rows[0].count,'1');
  assert.deepEqual((await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2',[tenant,crashSku.id])).rows[0],{on_hand:'5',reserved_order:'0'});
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  const transferLocation=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'CRASH-DEST','warehouse') RETURNING id",[tenant])).rows[0];
  const transferRequest={skuCode:'STOCK-CRASH',fromCode:'MAIN',toCode:'CRASH-DEST',quantity:2,requestId:randomUUID(),reason:'disposable transfer failure test'};
  for(const quantity of [true,[1],{value:1}]){
   await assert.rejects(()=>transferCentralWmsStock({...transferRequest,quantity,requestId:randomUUID()}),error=>error.status===400,'Malformed transfer quantity must reject before mutation');
   await assert.rejects(()=>adjustCentralWmsStock({masterSkuId:crashSku.id,locationId:location.id,quantity,reason:'fixture invalid shape',requestId:randomUUID()}),error=>error.status===400,'Malformed adjustment quantity must reject before mutation');
  }
  await db.query("CREATE FUNCTION codexqa_fail_transfer_in() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='wms_transfer_in' THEN RAISE EXCEPTION 'fixture destination event unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_transfer_in BEFORE INSERT ON ci_inventory_event FOR EACH ROW EXECUTE FUNCTION codexqa_fail_transfer_in()');
  try{
   await assert.rejects(()=>transferCentralWmsStock(transferRequest),/fixture destination event unavailable/);
   assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])",[tenant,[`wms-transfer:${transferRequest.requestId}:out`,`wms-transfer:${transferRequest.requestId}:in`]])).rows[0].count,'0');
   assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,location.id])).rows[0].on_hand,'5');
   assert.equal((await db.query('SELECT count(*) FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,transferLocation.id])).rows[0].count,'0');
  }finally{await db.query('DROP TRIGGER codexqa_transfer_in ON ci_inventory_event');await db.query('DROP FUNCTION codexqa_fail_transfer_in()');}
  assert.equal((await transferCentralWmsStock(transferRequest)).duplicate,false);
  assert.equal((await transferCentralWmsStock(transferRequest)).duplicate,true);
  assert.deepEqual((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 ORDER BY on_hand',[tenant,crashSku.id])).rows,[{on_hand:'2'},{on_hand:'3'}]);
  assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])",[tenant,[`wms-transfer:${transferRequest.requestId}:out`,`wms-transfer:${transferRequest.requestId}:in`]])).rows[0].count,'2');
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  const crashMove={...transferRequest,quantity:1,requestId:randomUUID()};
  const moveChild=spawn(process.execPath,['scripts/fixture-transfer-commit-crash.mjs'],{env:{...process.env,FIXTURE_TRANSFER_CHECKPOINT:'before-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const moveExit=new Promise(resolve=>moveChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Transfer commit checkpoint timeout')),10000);
    moveChild.once('error',error=>{clearTimeout(timer);reject(error);});
    moveChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Transfer exited before checkpoint'));});
    moveChild.on('message',message=>{if(message.checkpoint==='ready'){moveChild.send(crashMove);}else{clearTimeout(timer);assert.equal(message.checkpoint,'transfer-before-commit');resolve();}});
   });
   moveChild.kill('SIGKILL');assert.equal((await moveExit).signal,'SIGKILL');
  }finally{if(moveChild.exitCode===null&&moveChild.signalCode===null){moveChild.kill('SIGKILL');await moveExit;}}
  const moveKeys=[`wms-transfer:${crashMove.requestId}:out`,`wms-transfer:${crashMove.requestId}:in`];
  assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])',[tenant,moveKeys])).rows[0].count,'0');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,location.id])).rows[0].on_hand,'3');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,transferLocation.id])).rows[0].on_hand,'2');
  assert.equal((await transferCentralWmsStock(crashMove)).duplicate,false);
  assert.equal((await transferCentralWmsStock(crashMove)).duplicate,true);
  assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])',[tenant,moveKeys])).rows[0].count,'2');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,location.id])).rows[0].on_hand,'2');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,transferLocation.id])).rows[0].on_hand,'3');
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  {
  const crashMove={...transferRequest,quantity:1,requestId:randomUUID()};
  const moveChild=spawn(process.execPath,['scripts/fixture-transfer-commit-crash.mjs'],{env:{...process.env,FIXTURE_TRANSFER_CHECKPOINT:'after-commit'},stdio:['ignore','ignore','inherit','ipc']});
  const moveExit=new Promise(resolve=>moveChild.once('exit',(code,signal)=>resolve({code,signal})));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Transfer commit checkpoint timeout')),10000);
    moveChild.once('error',error=>{clearTimeout(timer);reject(error);});
    moveChild.once('exit',()=>{clearTimeout(timer);reject(new Error('Transfer exited before checkpoint'));});
    moveChild.on('message',message=>{if(message.checkpoint==='ready'){moveChild.send(crashMove);}else{clearTimeout(timer);assert.equal(message.checkpoint,'transfer-committed');resolve();}});
   });
   moveChild.kill('SIGKILL');assert.equal((await moveExit).signal,'SIGKILL');
  }finally{if(moveChild.exitCode===null&&moveChild.signalCode===null){moveChild.kill('SIGKILL');await moveExit;}}
  const moveKeys=[`wms-transfer:${crashMove.requestId}:out`,`wms-transfer:${crashMove.requestId}:in`];
  assert.equal((await transferCentralWmsStock(crashMove)).duplicate,true);
  assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])',[tenant,moveKeys])).rows[0].count,'2');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,location.id])).rows[0].on_hand,'1');
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,crashSku.id,transferLocation.id])).rows[0].on_hand,'4');
  await db.query("UPDATE ci_outbox SET status='held' WHERE tenant_id=$1 AND task_type='publish_stock' AND mapping_id IN (SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND master_sku_id=$2)",[tenant,crashSku.id]);
  }
  for(const priorDiagnosticAttempts of [0,7]){
  const delayedDiagnosticTask=(await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload,attempts) VALUES($1,$2,'delayed_diagnostic_fixture','{}',$3) RETURNING id",[tenant,wooAccount.id,priorDiagnosticAttempts])).rows[0];
  const diagnosticQuery=db.query;
  let signalDiagnostic,releaseDiagnostic,pausedDiagnostic=false;
  const reachedDiagnostic=new Promise(resolve=>{signalDiagnostic=resolve;});
  const diagnosticGate=new Promise(resolve=>{releaseDiagnostic=resolve;});
  db.query=function(sql,...args){
   if(!pausedDiagnostic&&typeof sql==='string'&&sql.startsWith('SELECT encrypted_credentials,credential_iv,credential_tag')&&args[0]?.[1]===wooAccount.id){pausedDiagnostic=true;signalDiagnostic();return diagnosticGate.then(()=>diagnosticQuery.call(this,sql,...args));}
   return diagnosticQuery.call(this,sql,...args);
  };
  const stalledBatch=runInventoryTaskBatch(1);
  let diagnosticTimer;
  try{
   await Promise.race([reachedDiagnostic,new Promise((_,reject)=>{diagnosticTimer=setTimeout(()=>reject(new Error('Diagnostic pause timeout')),5000);})]);
   const durable=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[delayedDiagnosticTask.id])).rows[0];
   assert.equal(durable.status,priorDiagnosticAttempts===7?'dead':'retry','Failure state must be durable while credential diagnostic lookup is stalled');
   assert.equal(durable.attempts,priorDiagnosticAttempts+1);assert.equal(durable.lease_until,null);assert.ok(durable.last_error);
   if(priorDiagnosticAttempts===0){
    await db.query("UPDATE ci_outbox SET available_at=now(),task_type='newer_diagnostic_fixture' WHERE id=$1",[delayedDiagnosticTask.id]);
    assert.equal(await runInventoryTaskBatch(1),1);
    const newer=(await db.query('SELECT attempts,last_error FROM ci_outbox WHERE id=$1',[delayedDiagnosticTask.id])).rows[0];
    assert.equal(newer.attempts,2);assert.match(newer.last_error,/newer_diagnostic_fixture/);
   }
  }finally{clearTimeout(diagnosticTimer);db.query=diagnosticQuery;releaseDiagnostic();await stalledBatch;}
  const afterDiagnostic=(await db.query('SELECT attempts,last_error FROM ci_outbox WHERE id=$1',[delayedDiagnosticTask.id])).rows[0];
  if(priorDiagnosticAttempts===0){assert.equal(afterDiagnostic.attempts,2);assert.match(afterDiagnostic.last_error,/newer_diagnostic_fixture/,'Old delayed enrichment must not overwrite newer attempt diagnostics');}
  else{assert.equal(afterDiagnostic.attempts,8);assert.equal(await runInventoryTaskBatch(1),0);}
  await db.query("UPDATE ci_outbox SET status='held' WHERE id=$1",[delayedDiagnosticTask.id]);
  }
  await db.query("UPDATE ci_order_alert SET available_at=now()+interval '1 day' WHERE tenant_id=$1 AND status='pending'",[tenant]);
  const retryAlertOrder=await transaction(tx=>recordIncomingOrder(tx,{tenantId:tenant,accountId:account.id,platform:'shopify',event:{id:'WA-RETRY-FIXTURE',created_at:new Date().toISOString(),line_items:[]},topic:'orders/create',packingAlerts:false}));
  const retryAlert=(await db.query('SELECT id FROM ci_order_alert WHERE tenant_id=$1 AND order_id=$2',[tenant,retryAlertOrder])).rows[0];
  await db.query("UPDATE ci_order_alert SET attempt_count=8 WHERE id=$1",[retryAlert.id]);
  let rejectedSends=0;const rejectSend=async()=>{rejectedSends++;return {ok:false,status:429};};
  assert.equal((await runWhatsAppBatch(1,rejectSend)).claimed,0,'Exhausted pending notification must never send attempt nine');
  assert.equal(rejectedSends,0);
  assert.equal((await db.query('SELECT status FROM ci_order_alert WHERE id=$1',[retryAlert.id])).rows[0].status,'failed');
  await db.query("UPDATE ci_order_alert SET status='pending',attempt_count=0,available_at=now() WHERE id=$1",[retryAlert.id]);
  for(let execution=1;execution<=8;execution++){
   await db.query('UPDATE ci_order_alert SET available_at=now() WHERE id=$1',[retryAlert.id]);
   assert.equal((await runWhatsAppBatch(1,rejectSend)).claimed,1);
   const state=(await db.query('SELECT status,attempt_count,claimed_at FROM ci_order_alert WHERE id=$1',[retryAlert.id])).rows[0];
   assert.equal(state.attempt_count,execution);assert.equal(state.status,execution===8?'failed':'pending');assert.equal(state.claimed_at,null);
  }
  assert.equal(rejectedSends,8);assert.equal((await runWhatsAppBatch(1,rejectSend)).claimed,0);assert.equal(rejectedSends,8);
  const notificationCases=[
   {name:'authentication',expected:'failed',fetcher:async()=>({ok:false,status:401})},
   {name:'authorization',expected:'failed',fetcher:async()=>({ok:false,status:403})},
   {name:'transient',expected:'pending',fetcher:async()=>({ok:false,status:503})},
   {name:'timeout',expected:'uncertain',fetcher:async(_url,options)=>{options.onDispatch();throw new Error('fixture-private-network-secret');}},
   {name:'lost-message-id',expected:'uncertain',fetcher:async()=>({ok:true,status:200,json:async()=>{throw new Error('fixture-private-response-secret');}})},
   {name:'malformed-exception',expected:'uncertain',fetcher:async(_url,options)=>{options.onDispatch();throw null;}},
  ];
  for(const failureCase of notificationCases){
   await db.query("UPDATE ci_order_alert SET status='pending',attempt_count=0,available_at=now(),last_error=NULL WHERE id=$1",[retryAlert.id]);
   let calls=0;const fetcher=async(...args)=>{calls++;return failureCase.fetcher(...args);};
   assert.equal((await runWhatsAppBatch(1,fetcher)).claimed,1);
   const state=(await db.query('SELECT status,attempt_count,claimed_at,last_error,extract(epoch from (available_at-now())) AS delay FROM ci_order_alert WHERE id=$1',[retryAlert.id])).rows[0];
   assert.equal(state.status,failureCase.expected,failureCase.name);assert.equal(state.attempt_count,1);assert.equal(state.claimed_at,null);
   assert.ok(state.last_error);assert.doesNotMatch(state.last_error,/fixture-private/);
   if(state.status==='pending'){assert.ok(Number(state.delay)>55&&Number(state.delay)<=75);}
   else{assert.equal((await runWhatsAppBatch(1,fetcher)).claimed,0);assert.equal(calls,1,'Terminal or uncertain outcome must not automatically send again');}
  }
  const observationChild=spawn(process.execPath,['--no-warnings','--experimental-loader','./scripts/fixture-observation-provider-loader.mjs','scripts/verify-observation-success-audit.mjs'],{env:process.env,stdio:'inherit'});
  const observationExit=await new Promise((resolve,reject)=>{observationChild.once('error',reject);observationChild.once('exit',resolve);});
  assert.equal(observationExit,0,'Isolated success observation audit regression must pass');
  for(const thrown of [null,{get message(){throw new Error('unsafe formatting');}}, {message:{toString(){throw new Error('unsafe conversion');}}}]){
   const malformedTask=(await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload) VALUES($1,$2,'shopify_ingress',$3) RETURNING id",[tenant,account.id,JSON.stringify({topic:'inventory_levels/update',event:{inventory_item_id:'fixture-malformed',location_id:'fixture'}})])).rows[0];
   const originalQuery=db.query;
   let injected=false;
   db.query=function(sql,...args){
    if(!injected&&typeof sql==='string'&&sql.startsWith('SELECT id FROM ci_channel_mapping')&&args[0]?.[2]==='gid://shopify/InventoryItem/fixture-malformed'){injected=true;return Promise.reject(thrown);}
    return originalQuery.call(this,sql,...args);
   };
   try{assert.equal(await runInventoryTaskBatch(1),1);}finally{db.query=originalQuery;}
   assert.equal(injected,true);
   const state=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[malformedTask.id])).rows[0];
   assert.equal(state.status,'retry');assert.equal(state.attempts,1);assert.equal(state.lease_until,null);assert.ok(state.last_error);
   await db.query("UPDATE ci_outbox SET status='dead' WHERE id=$1",[malformedTask.id]);
  }
  await db.query("CREATE FUNCTION codexqa_fail_reconcile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='shopify_readback' THEN RAISE EXCEPTION 'fixture reconciliation audit unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_reconcile_audit_failure BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_reconcile_audit()');
  try{
   const reconciliation=await reconcileShopifyStock(tenant);
   assert.ok(reconciliation.errors.length>0,'Missing credential readback failures must remain visible when diagnostic storage fails');
  }finally{await db.query('DROP TRIGGER codexqa_reconcile_audit_failure ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_reconcile_audit()');}
  const meesho=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id) VALUES($1,'meesho','diagnostic-fixture') RETURNING *",[tenant])).rows[0];
  const meeshoInput={tenantId:tenant,account:meesho,fileName:'fixture.csv',bytes:Buffer.from('Order,SKU,Quantity,Status\nDIAGNOSTIC-1,TEE-M,2,Pending\n'),headerRow:1,reportAsOf:'2026-09-25T00:00:00.000Z',mapping:{subOrderId:'Order',sku:'SKU',quantity:'Quantity',status:'Status'}};
  const eventsBeforeMeesho=(await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].count;
  await db.query("CREATE FUNCTION codexqa_fail_meesho_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='meesho_order_report' THEN RAISE EXCEPTION 'fixture report diagnostic unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_meesho_diagnostic BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_meesho_diagnostic()');
  try{
   assert.deepEqual(await importMeeshoOrders(meeshoInput),{duplicate:false,orders:1,lines:1});
   assert.deepEqual(await importMeeshoOrders(meeshoInput),{duplicate:true,orders:0,lines:0});
   assert.equal((await db.query('SELECT count(*) FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2',[tenant,meesho.id])).rows[0].count,'1');
   assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].count,eventsBeforeMeesho);
  }finally{await db.query('DROP TRIGGER codexqa_meesho_diagnostic ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_meesho_diagnostic()');}
  const retestSecret=sealCredential({shop:'fixture.myshopify.com',accessToken:'shpat_12345678901234567890123456789012',apiVersion:'2026-07'});
  await db.query("UPDATE ci_channel_account SET encrypted_credentials=$2,credential_iv=$3,credential_tag=$4,connection_state='verified' WHERE id=$1",[account.id,retestSecret.encrypted,retestSecret.iv,retestSecret.tag]);
  await db.query("CREATE FUNCTION codexqa_fail_retest_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation IN ('credential_retest','connect_test') THEN RAISE EXCEPTION 'fixture retest diagnostic unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_retest_diagnostic BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_retest_diagnostic()');
  try{
   const retest=await verifyAndSave(tenant,'shopify',{}, {id:account.id,fetcher:async()=>({ok:false,status:401,json:async()=>({error:'fixture denied'})})});
   assert.equal(retest.ok,false);
   assert.equal((await db.query('SELECT connection_state FROM ci_channel_account WHERE id=$1',[account.id])).rows[0].connection_state,'token_expired');
   const cyclicDiagnostic={};cyclicDiagnostic.self=cyclicDiagnostic;
   for(const thrown of [null,{get message(){throw new Error('unsafe provider getter');}},{message:'fixture failure',providerStatus:401,diagnostic:cyclicDiagnostic}]){
    await db.query("UPDATE ci_channel_account SET connection_state='verified' WHERE id=$1",[account.id]);
    const malformed=await verifyAndSave(tenant,'shopify',{}, {id:account.id,fetcher:async()=>{throw thrown;}});
    assert.equal(malformed.ok,false);
    assert.equal((await db.query('SELECT connection_state FROM ci_channel_account WHERE id=$1',[account.id])).rows[0].connection_state,thrown?.providerStatus===401?'token_expired':'error');
   }
   const probeFixture={shop:{myshopifyDomain:'fixture.myshopify.com'},currentAppInstallation:{accessScopes:['read_products','read_inventory','write_inventory','read_orders','read_locations'].map(handle=>({handle}))},products:{nodes:[]},locations:{nodes:[],pageInfo:{hasNextPage:false}}};
   const successful=await verifyAndSave(tenant,'shopify',{}, {id:account.id,fetcher:async()=>({ok:true,status:200,json:async()=>({data:probeFixture})})});
   assert.equal(successful.ok,true);
   assert.equal((await db.query('SELECT connection_state FROM ci_channel_account WHERE id=$1',[account.id])).rows[0].connection_state,'verified');

  }finally{await db.query('DROP TRIGGER codexqa_retest_diagnostic ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_retest_diagnostic()');}
  const observationTenant=`observation-${randomUUID()}`;
  for(const platform of ['flipkart','shopify'])for(let index=0;index<2;index++){
   await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,settings) VALUES($1,$2,$3,$4)",[observationTenant,platform,`fixture-${index}`,JSON.stringify(platform==='shopify'?{orderObservationEnabled:true}:{observationEnabled:true})]);
  }
  await db.query("CREATE FUNCTION codexqa_fail_observation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation IN ('scheduled_provider_observation','shopify_order_observation') THEN RAISE EXCEPTION 'fixture observation audit unavailable'; END IF; RETURN NEW; END $$");
  await db.query('CREATE TRIGGER codexqa_observation_audit_failure BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_observation_audit()');
  try{
   assert.deepEqual(await observeSellerConnections(observationTenant),{checked:0,failed:2},'Audit outage cannot stop the next seller account failure from being recorded');
   const observation=await pollShopifyOrderObservations(observationTenant);
   assert.equal(observation.errors.length,2);
   assert.equal((await db.query("SELECT count(*) FROM ci_sync_cursor WHERE tenant_id=$1 AND failure_count=1 AND retry_after>now()",[observationTenant])).rows[0].count,'2','Both order poll failures must persist retry state despite audit outage');
   assert.equal((await db.query("SELECT count(*) FROM ci_channel_account WHERE tenant_id=$1 AND connection_state='error'",[observationTenant])).rows[0].count,'4');
  }finally{await db.query('DROP TRIGGER codexqa_observation_audit_failure ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_observation_audit()');}
  await db.query("UPDATE ci_outbox SET status='processing',attempts=8,lease_until=now()+interval '1 minute',last_error=NULL WHERE id=$1",[poison.id]);
  assert.equal(await runInventoryTaskBatch(1),0,'Live final attempt must not be terminalized prematurely');
  assert.equal((await db.query('SELECT status FROM ci_outbox WHERE id=$1',[poison.id])).rows[0].status,'processing');
  await db.query("UPDATE ci_outbox SET attempts=7,lease_until=now()-interval '1 second' WHERE id=$1",[poison.id]);
  assert.equal(await runInventoryTaskBatch(1),1,'Expired seventh attempt can still claim its eighth execution');
  assert.equal((await db.query('SELECT attempts FROM ci_outbox WHERE id=$1',[poison.id])).rows[0].attempts,8);
  for(const interruptedStatus of ['processing','retry']){
   await db.query("UPDATE ci_outbox SET status=$2,attempts=8,lease_until=now()-interval '1 second',available_at=now(),last_error=NULL WHERE id=$1",[poison.id,interruptedStatus]);
   assert.equal(await runInventoryTaskBatch(1),0,'Exhausted lease recovery must not execute attempt nine');
   const exhausted=(await db.query('SELECT status,attempts,lease_until,last_error FROM ci_outbox WHERE id=$1',[poison.id])).rows[0];
   assert.equal(exhausted.status,'dead');assert.equal(exhausted.attempts,8);assert.equal(exhausted.lease_until,null);
   assert.match(exhausted.last_error,/reconcil/i,'Unknown crashed outcome must remain explicit for operators');
  }
  console.log('PASS unified orders: signed/replayed ingress, tenant queue/sender isolation, lease redelivery, revision rejection, cancel/dispatch races, provider-state separation, credential-failure retry/dead-letter, pack-unit conversion/replay/conflict/overflow, reservation SKU/location identity, return replay, staff guards, and oversell rejection');
 }finally{await new Promise(resolve=>server.close(resolve));}
}finally{await closeDataStore();await db.end();}
