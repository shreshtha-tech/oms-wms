import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { acceptShopifyWebhook } from '../inventory/ingress.js';
import { processInventoryTask, reconcileShopifyStock } from '../inventory/workers.js';
import { recordStockObservation } from '../inventory/stock-observations.js';
import { sealCredential } from '../inventory/credentials.js';
const url=new URL(process.env.INVENTORY_DATABASE_URL||'');assert.match(url.pathname,/codexqa_test_reliable_/);assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname));
const tenant=`observation-${randomUUID()}`,secret='controlled-signature-secret';
process.env.INVENTORY_CREDENTIAL_KEY='0'.repeat(64);
await migrateInventory();const db=inventoryPool();
try{
 const sku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'OBS-SKU','Ordering fixture') RETURNING id",[tenant])).rows[0].id;
 const location=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'OBS-WH','warehouse') RETURNING id",[tenant])).rows[0].id;
 const accounts={};const mappings={};
 for(const platform of ['shopify','amazon']){
  accounts[platform]=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status) VALUES($1,$2,$3,'active') RETURNING id",[tenant,platform,platform==='shopify'?'fixture-observation.myshopify.com':`fixture-${platform}`])).rows[0].id;
  mappings[platform]=(await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,internal_location_id,external_sku,listing_id,external_location_id,active) VALUES($1,$2,$3,$4,'OBS-SKU','gid://shopify/InventoryItem/1','gid://shopify/Location/1',true) RETURNING id",[tenant,accounts[platform],sku,location])).rows[0].id;
 }
 const oldTime=new Date(Date.now()-60000).toISOString(),newTime=new Date(Date.now()-30000).toISOString();
 const event=(quantity,updated_at)=>({inventory_item_id:1,location_id:1,available:quantity,updated_at});
 const raw=Buffer.from(JSON.stringify(event(12,newTime)));
 await acceptShopifyWebhook({tenantId:tenant,accountId:accounts.shopify,topic:'inventory_levels/update',messageId:'signed-observation',rawBody:raw,hmac:createHmac('sha256',secret).update(raw).digest('base64'),secret});
 const signed=(await db.query("SELECT * FROM ci_outbox WHERE tenant_id=$1 AND payload->>'messageId'='signed-observation'",[tenant])).rows[0];
 assert.equal(signed.payload.event.updated_at,newTime,'Ingress must retain provider resource version time');
 await processInventoryTask(signed);
 const task=(platform,quantity,time)=>platform==='shopify'?{tenant_id:tenant,account_id:accounts.shopify,task_type:'shopify_ingress',payload:{topic:'inventory_levels/update',event:event(quantity,time)}}:{tenant_id:tenant,account_id:accounts.amazon,task_type:'amazon_ingress',payload:{NotificationType:'LISTINGS_ITEM_MFN_QUANTITY_CHANGE',EventTime:time,Payload:{Sku:'OBS-SKU',Quantity:quantity}}};
 for(const platform of ['shopify','amazon']){
  await processInventoryTask(task(platform,12,newTime));
  await Promise.all([processInventoryTask(task(platform,1,oldTime)),processInventoryTask(task(platform,12,newTime)),processInventoryTask(task(platform,3,oldTime))]);
  assert.equal(Number((await db.query('SELECT observed_quantity FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,mappings[platform]])).rows[0].observed_quantity),12);
  await assert.rejects(processInventoryTask(task(platform,99,newTime)),error=>error.code==='OBSERVATION_RECONCILIATION_REQUIRED');
  for(const time of [undefined,'invalid',new Date(Date.now()+3600000).toISOString()])await assert.rejects(processInventoryTask(task(platform,99,time)),error=>error.code==='OBSERVATION_RECONCILIATION_REQUIRED');
  await assert.rejects(processInventoryTask(task(platform,null,newTime)),error=>error.code==='OBSERVATION_RECONCILIATION_REQUIRED');
  assert.equal(Number((await db.query('SELECT observed_quantity FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,mappings[platform]])).rows[0].observed_quantity),12);
 }
 await assert.rejects(recordStockObservation({tenantId:'foreign',mappingId:mappings.shopify,quantity:5,eventTime:newTime}),error=>error.code==='OBSERVATION_RECONCILIATION_REQUIRED');
 const credentials=sealCredential({accessToken:'controlled-provider-token'});
 await db.query('UPDATE ci_channel_account SET encrypted_credentials=$2,credential_iv=$3,credential_tag=$4 WHERE id=$1',[accounts.shopify,credentials.encrypted,credentials.iv,credentials.tag]);
 await db.query('INSERT INTO ci_inventory_balance(tenant_id,master_sku_id,location_id,on_hand) VALUES($1,$2,$3,12)',[tenant,sku,location]);
 let readStarted,releaseRead;const started=new Promise(resolve=>readStarted=resolve),blocked=new Promise(resolve=>releaseRead=resolve);
 const reconciliation=reconcileShopifyStock(tenant,{fetcher:async()=>{readStarted();await blocked;return{ok:true,status:200,json:async()=>({data:{inventoryItem:{inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1'},quantities:[{name:'available',quantity:1}]}]}}}})};}});
 await Promise.race([started,reconciliation.then(()=>{throw new Error('Reconciliation ended before the controlled read started');})]);
 await new Promise(resolve=>setTimeout(resolve,10));
 const newestTime=new Date().toISOString();await processInventoryTask(task('shopify',12,newestTime));
 releaseRead();const summary=await reconciliation;assert.equal(summary.mismatched,0);assert.equal(summary.checked,0);assert.deepEqual(summary.errors,[]);
 assert.equal(Number((await db.query('SELECT observed_quantity FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenant,mappings.shopify])).rows[0].observed_quantity),12);
 assert.equal((await db.query("SELECT count(*) FROM ci_outbox WHERE tenant_id=$1 AND task_type='publish_stock'",[tenant])).rows[0].count,'0','A stale provider read must not enqueue a repair');
 assert.equal((await db.query('SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].count,'0');
 console.log('PASS real PostgreSQL provider observation ordering: signed Shopify timestamp retained, Shopify/Amazon stale/replayed/concurrent events cannot overwrite newer quantity, equal-time conflicts and invalid observations fail closed, no physical stock writes');
}finally{await db.end();}
