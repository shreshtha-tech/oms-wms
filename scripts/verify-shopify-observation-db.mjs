import assert from 'node:assert/strict';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { sealCredential } from '../inventory/credentials.js';
import { pollShopifyOrderObservations } from '../inventory/shopify-orders.js';

const url=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Use an owned loopback _test database');
process.env.INVENTORY_CREDENTIAL_KEY='0'.repeat(64);
await migrateInventory();
const db=inventoryPool(),tenant='shopify-poll-fixture';
try {
 const sealed=sealCredential({shop:'fixture.myshopify.com',accessToken:'fixture-token'});
 const account=(await db.query(`INSERT INTO ci_channel_account
   (tenant_id,platform,external_account_id,status,connection_state,verified_at,settings,encrypted_credentials,credential_iv,credential_tag)
   VALUES($1,'shopify','fixture.myshopify.com','inactive','verified',now(),'{"orderObservationEnabled":true}',$2,$3,$4) RETURNING id`,
   [tenant,sealed.encrypted,sealed.iv,sealed.tag])).rows[0];
 const order={legacyResourceId:'9007199254740993',createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T01:00:00Z',cancelledAt:null,displayFulfillmentStatus:'UNFULFILLED',
   lineItems:{nodes:[{id:'gid://shopify/LineItem/123',sku:'FIXTURE-SKU',quantity:2,name:'Fixture'}],pageInfo:{hasNextPage:false}}};
 const clientFactory=()=>({graphql:async()=>({orders:{nodes:[order],pageInfo:{hasNextPage:false,endCursor:null}}})});
 const poll=()=>pollShopifyOrderObservations(tenant,{clientFactory});
 assert.deepEqual(await poll(),{accounts:1,orders:1,errors:[]});
 const firstCursor=(await db.query("SELECT last_success_at FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenant,account.id])).rows[0].last_success_at;
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM ci_ingress WHERE tenant_id=$1 AND source=$2',[tenant,`shopify:${account.id}`])).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM ci_unified_order WHERE tenant_id=$1',[tenant])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::integer AS n FROM ci_outbox WHERE tenant_id=$1 AND task_type='shopify_ingress'",[tenant])).rows[0].n,0,'Observation does not enqueue stock work');
 assert.deepEqual(await poll(),{accounts:1,orders:1,errors:[]});
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM ci_ingress WHERE tenant_id=$1 AND source=$2',[tenant,`shopify:${account.id}`])).rows[0].n,1,'Same revision reuses one durable receipt');
 const secondCursor=(await db.query("SELECT last_success_at FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenant,account.id])).rows[0].last_success_at;
 assert.ok(secondCursor>=firstCursor);
 order.lineItems.nodes[0].name='Changed under same revision';
 const conflict=await poll();assert.equal(conflict.accounts,0);assert.equal(conflict.errors.length,1);
 assert.equal((await db.query("SELECT last_success_at FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenant,account.id])).rows[0].last_success_at.toISOString(),secondCursor.toISOString(),'Changed-content conflict must not checkpoint');
 await db.query("UPDATE ci_sync_cursor SET retry_after=NULL WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenant,account.id]);
 order.updatedAt='2026-10-07T02:00:00Z';order.lineItems.nodes[0].id=null;
 const malformed=await poll();assert.equal(malformed.accounts,0);assert.equal(malformed.errors.length,1);
 assert.equal((await db.query("SELECT last_success_at FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenant,account.id])).rows[0].last_success_at.toISOString(),secondCursor.toISOString(),'Malformed order must not checkpoint');
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM ci_ingress WHERE tenant_id=$1 AND source=$2',[tenant,`shopify:${account.id}`])).rows[0].n,1,'Rejected order must not create a receipt');
 console.log('PASS isolated Shopify poll receipt replay, changed revision conflict, malformed-order checkpoint guard and observation-only work');
} finally { await db.end(); }
