import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inventoryPool } from '../inventory/db.js';
import { sealCredential } from '../inventory/credentials.js';
import { observeSellerConnections } from '../inventory/connection-observation.js';
import { pollShopifyOrderObservations } from '../inventory/shopify-orders.js';
import { reconcileShopifyStock } from '../inventory/workers.js';
import { provisionWebhooks, discoverConnectionCatalog } from '../inventory/connection-setup.js';
import { applyInventoryEvent } from '../inventory/ledger.js';

const uri=new URL(process.env.INVENTORY_DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(uri.hostname)&&uri.pathname.startsWith('/codexqa_test_'));
const tenant=`observation-success-${randomUUID()}`,db=inventoryPool();
try{
 for(const platform of ['flipkart','shopify'])for(let index=0;index<2;index++){
  const sealed=sealCredential({accessToken:randomUUID(),webhookSecret:randomUUID()});
  await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,settings,encrypted_credentials,credential_iv,credential_tag) VALUES($1,$2,$3,$4,$5,$6,$7)",[tenant,platform,`fixture-${index}`,JSON.stringify(platform==='shopify'?{orderObservationEnabled:true}:{observationEnabled:true}),sealed.encrypted,sealed.iv,sealed.tag]);
 }
 const sku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'AUDIT-FIXTURE','Fixture') RETURNING id",[tenant])).rows[0];
 const location=(await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'FIXTURE','warehouse') RETURNING id",[tenant])).rows[0];
 await applyInventoryEvent({tenantId:tenant,masterSkuId:sku.id,locationId:location.id,eventKey:'fixture-opening',eventType:'count',source:'fixture',delta_on_hand:5});
 const accounts=(await db.query("UPDATE ci_channel_account SET status='active' WHERE tenant_id=$1 AND platform='shopify' RETURNING id,external_account_id",[tenant])).rows;
 for(const account of accounts){
  await db.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,internal_location_id,active) VALUES($1,$2,$3,'AUDIT-FIXTURE',$4,$5,true)",[tenant,account.id,sku.id,account.external_account_id==='fixture-0'?'fixture-match':'fixture-mismatch',location.id]);
 }
 const before=(await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1',[tenant])).rows;
 await db.query("CREATE FUNCTION codexqa_fail_success_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation IN ('scheduled_provider_observation','shopify_order_observation','shopify_readback','webhooks_registered','catalog_mapping') THEN RAISE EXCEPTION 'fixture success diagnostic unavailable'; END IF; RETURN NEW; END $$");
 await db.query('CREATE TRIGGER codexqa_success_observation BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_success_observation()');
 try{
  assert.deepEqual(await observeSellerConnections(tenant),{checked:2,failed:0});
  assert.deepEqual(await pollShopifyOrderObservations(tenant),{accounts:2,orders:0,errors:[]});
  assert.equal((await db.query("SELECT count(*) FROM ci_channel_account WHERE tenant_id=$1 AND connection_state='verified'",[tenant])).rows[0].count,'4');
  assert.equal((await db.query('SELECT count(*) FROM ci_sync_cursor WHERE tenant_id=$1 AND last_success_at IS NOT NULL AND failure_count=0 AND retry_after IS NULL',[tenant])).rows[0].count,'2');
  assert.deepEqual(await reconcileShopifyStock(tenant),{checked:2,mismatched:1,unavailable:0,errors:[]});
  const stocks=(await db.query('SELECT target_quantity,observed_quantity,publish_state FROM ci_channel_stock WHERE tenant_id=$1 ORDER BY observed_quantity',[tenant])).rows;
  assert.deepEqual(stocks,[{target_quantity:'5',observed_quantity:'2',publish_state:'pending'},{target_quantity:'5',observed_quantity:'5',publish_state:'confirmed'}]);
  assert.equal((await db.query("SELECT count(*) FROM ci_outbox WHERE tenant_id=$1 AND task_type='publish_stock'",[tenant])).rows[0].count,'1');
  assert.deepEqual((await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1',[tenant])).rows,before,'Reconciliation must not alter physical ledger balances');
  const setupAccount=(await db.query('SELECT * FROM ci_channel_account WHERE id=$1',[accounts[0].id])).rows[0];
  const provisioned=await provisionWebhooks(setupAccount,'https://fixture.example');
  assert.equal(provisioned.registered,5);
  const setupSettings=(await db.query('SELECT settings FROM ci_channel_account WHERE id=$1',[setupAccount.id])).rows[0].settings;
  assert.equal(setupSettings.webhooksReady,true);assert.equal(setupSettings.webhookIds.length,5);
  await db.query("INSERT INTO ci_connection_location(tenant_id,account_id,external_location_id,internal_location_id) VALUES($1,$2,'',$3)",[tenant,setupAccount.id,location.id]);
  assert.deepEqual(await discoverConnectionCatalog(setupAccount),{staged:1,unmatched:0,skipped:0,duplicateSkus:[]});
  const discovered=(await db.query('SELECT status,settings FROM ci_channel_account WHERE id=$1',[setupAccount.id])).rows[0];
  assert.equal(discovered.status,'inactive');assert.equal(discovered.settings.discoveredMappingIds.length,1);
  const staged=(await db.query('SELECT listing_id,active,approved_at FROM ci_channel_mapping WHERE id=$1',[discovered.settings.discoveredMappingIds[0]])).rows[0];
  assert.deepEqual(staged,{listing_id:'fixture-catalog-item',active:false,approved_at:null});
  assert.deepEqual((await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1',[tenant])).rows,before);
  console.log('PASS GENERATED_LOCAL provider double: diagnostic outage preserves success state and subsequent account processing; no REAL_PROVIDER evidence.');
 }finally{
  await db.query('DROP TRIGGER codexqa_success_observation ON ci_sync_attempt');
  await db.query('DROP FUNCTION codexqa_fail_success_observation()');
 }
}finally{await db.end();}
