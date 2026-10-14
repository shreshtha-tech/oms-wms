import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { sealCredential } from '../inventory/credentials.js';
import { publishStockTask, reconcileShopifyStock } from '../inventory/workers.js';

const testDatabase=new URL(process.env.INVENTORY_DATABASE_URL||'');if(!['localhost','127.0.0.1','[::1]'].includes(testDatabase.hostname)||!/(?:^|[_-])(?:test|contract)(?:[_-]|$)/i.test(decodeURIComponent(testDatabase.pathname.slice(1))))throw new Error('Use a local isolated test/contract inventory database');
process.env.INVENTORY_CREDENTIAL_KEY = '0'.repeat(64);
const db = inventoryPool();
const tenant = `publish-test-${randomUUID()}`;
const sku = randomUUID(), location = randomUUID(), account = randomUUID(), mapping = randomUUID();
let remote = 0;
const mutations = [];
let firstMutationStarted;
const firstMutation = new Promise(resolve => { firstMutationStarted = resolve; });
let releaseFirst;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });

try {
  await migrateInventory();
  await db.query('INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,$3,$4)', [sku, tenant, 'RACE-SKU', 'Race test']);
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'WH','warehouse')", [location, tenant]);
  const credentials = sealCredential({ accessToken: 'mock-token' });
  await db.query("INSERT INTO ci_channel_account(id,tenant_id,platform,external_account_id,status,encrypted_credentials,credential_iv,credential_tag) VALUES($1,$2,'shopify','race-test.myshopify.com','active',$3,$4,$5)", [account, tenant, credentials.encrypted, credentials.iv, credentials.tag]);
  await db.query("INSERT INTO ci_channel_mapping(id,tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id,active) VALUES($1,$2,$3,$4,'RACE-SKU','gid://shopify/InventoryItem/1','gid://shopify/Location/1',$5,true)", [mapping, tenant, account, sku, location]);
  const base = { tenantId: tenant, masterSkuId: sku, locationId: location, source: 'test' };
  const firstEvent=await applyInventoryEvent({ ...base, eventKey: 'opening', eventType: 'count', delta_on_hand: 500 });
  const taskForEvent=async eventId=>{
    const claimed=await db.query(`UPDATE ci_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes'
      WHERE tenant_id=$1 AND task_type='publish_stock' AND payload->>'eventId'=$2 AND status IN ('pending','retry') RETURNING *`,[tenant,eventId]);
    assert.equal(claimed.rowCount,1,'Each publication needs a durable claimed outbox task');return claimed.rows[0];
  };
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.startsWith('query')) return { ok: true, status: 200, json: async () => ({ data: { inventoryItem: { inventoryLevels: { nodes: [{ location: { id: 'gid://shopify/Location/1' }, quantities: [{ name: 'available', quantity: remote }] }] } } } }) };
    const quantity = request.variables.input.quantities[0].quantity;
    if (mutations.length === 0) { firstMutationStarted(); await firstGate; }
    mutations.push({ quantity, key: request.variables.idempotencyKey });
    remote = quantity;
    return { ok: true, status: 200, json: async () => ({ data: { inventorySetQuantities: { userErrors: [] } } }) };
  };
  const older = publishStockTask(await taskForEvent(firstEvent.eventId),{fetcher});
  await firstMutation;
  const secondEvent=await applyInventoryEvent({ ...base, eventKey: 'sale-five', eventType: 'reserve', delta_reserved_order: 5, reservation: { action: 'reserve', orderId: 'ORDER-1', lineId: 'LINE-1', quantity: 5 } });
  const newer = publishStockTask(await taskForEvent(secondEvent.eventId),{fetcher});
  releaseFirst();
  await Promise.all([older, newer]);
  assert.deepEqual(mutations.map(x => x.quantity), [500, 495]);
  assert.notEqual(mutations[0].key, mutations[1].key);
  assert.equal(remote, 495);
  const state = await db.query('SELECT target_quantity FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2', [tenant, mapping]);
  assert.equal(Number(state.rows[0].target_quantity), 495);
  const clean = await reconcileShopifyStock(tenant,{fetcher});
  assert.equal(clean.checked, 1);
  assert.equal(clean.mismatched, 0);
  remote = 400;
  const drift = await reconcileShopifyStock(tenant,{fetcher});
  assert.equal(drift.mismatched, 1);
  const repair = await db.query("SELECT id FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND payload->>'source'='shopify_reconcile' ORDER BY id DESC LIMIT 1", [tenant, mapping]);
  assert.equal(repair.rowCount, 1);
  const repairTask=(await db.query("UPDATE ci_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,repair.rows[0].id])).rows[0];
  await publishStockTask(repairTask,{fetcher});
  assert.equal(remote, 495);
  console.log('PASS inventory publication order and Shopify readback: overlapping sale ends at 495 and drift is corrected');
} finally {
  releaseFirst();
  await db.end();
}
