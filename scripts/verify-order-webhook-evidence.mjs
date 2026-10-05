import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';
import { acceptShopifyWebhook } from '../inventory/ingress.js';
import { recordOrderWebhookEvidence } from '../inventory/webhook-evidence.js';
import { connectionReadiness } from '../inventory/connection-readiness.js';
import express from 'express';
import { inventoryPublic } from '../inventory/http.js';
import { sealCredential } from '../inventory/credentials.js';

const url = new URL(process.env.INVENTORY_DATABASE_URL || '');
assert.match(url.pathname, /codexqa_test_reliable_/);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname));
await migrateInventory();
const db = inventoryPool(), tenant = `webhook-evidence-${randomUUID()}`, secret = 'controlled-webhook-secret';
process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
let server;
try {
  const account = (await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,connection_state,verified_at,settings) VALUES($1,'shopify','fixture-evidence.myshopify.com','inactive','verified',now(),$2) RETURNING *", [tenant, { orderObservationEnabled: true, webhooksReady: true }])).rows[0];
  const send = (topic, messageId, body, signatureSecret = secret) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    return acceptShopifyWebhook({ tenantId: tenant, accountId: account.id, topic, messageId, rawBody, hmac: createHmac('sha256', signatureSecret).update(rawBody).digest('base64'), secret, observeOnly: true });
  };
  const settings = async () => (await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2', [tenant, account.id])).rows[0].settings;
  await send('inventory_levels/update', 'inventory-only', { inventory_item_id: 1, location_id: 1, available: 3, updated_at: new Date().toISOString() });
  assert.equal((await settings()).lastOrderWebhookAt, undefined);
  assert.equal(connectionReadiness(account).orders.state, 'starting', 'registration and unrelated callback do not prove order delivery');
  await assert.rejects(send('orders/create', 'bad-signature', { id: 10 }, 'wrong-secret'), error => error.status === 401);
  assert.equal((await settings()).lastOrderWebhookAt, undefined);
  for (const id of [undefined, {}, '', 0, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(send('orders/create', `invalid-${JSON.stringify(id)}`, { id }), error => error.status === 400);
  }
  assert.equal((await settings()).lastOrderWebhookAt, undefined);
  const body = { id: 10, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), line_items: [] };
  await send('orders/create', 'order-accepted', body);
  const first = (await settings()).lastOrderWebhookAt;
  assert.ok(Number.isFinite(Date.parse(first)));
  assert.equal(connectionReadiness(account, { lastWebhookAt: first }).orders.state, 'live');
  assert.equal((await send('orders/create', 'order-accepted', body)).duplicate, true);
  assert.equal((await settings()).lastOrderWebhookAt, first, 'duplicate delivery must not refresh evidence');
  await assert.rejects(send('orders/create', 'order-accepted', { ...body, id: 11 }), error => error.status === 409);
  assert.equal((await settings()).lastOrderWebhookAt, first);
  await assert.rejects(transaction(client => recordOrderWebhookEvidence(client, { tenantId: 'other-tenant', accountId: account.id, platform: 'shopify', topic: 'orders/create' })), error => error.status === 409);
  assert.equal((await settings()).lastOrderWebhookAt, first, 'cross-tenant evidence write is rejected');
  await assert.rejects(transaction(async client => {
    await recordOrderWebhookEvidence(client, { tenantId: tenant, accountId: account.id, platform: 'shopify', topic: 'orders/create' });
    throw new Error('controlled transaction crash');
  }), /controlled transaction crash/);
  assert.equal((await settings()).lastOrderWebhookAt, first, 'rolled-back acceptance must not confirm delivery');
  process.env.INVENTORY_CREDENTIAL_KEY = '0'.repeat(64);
  const sealed = sealCredential({ webhookSecret: secret });
  await db.query('UPDATE ci_channel_account SET encrypted_credentials=$3,credential_iv=$4,credential_tag=$5 WHERE tenant_id=$1 AND id=$2', [tenant, account.id, sealed.encrypted, sealed.iv, sealed.tag]);
  const woo = (await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,connection_state,verified_at,settings,encrypted_credentials,credential_iv,credential_tag) VALUES($1,'woocommerce','https://fixture.example','inactive','verified',now(),$2,$3,$4,$5) RETURNING *", [tenant, { orderObservationEnabled: true, webhooksReady: true }, sealed.encrypted, sealed.iv, sealed.tag])).rows[0];
  const app = express(); app.use(inventoryPublic);
  server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
  const endpoint = `http://127.0.0.1:${server.address().port}/woocommerce/${woo.id}/webhook`;
  const wooSend = async (id, body) => {
    const raw = JSON.stringify(body);
    return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-delivery-id': id, 'x-wc-webhook-signature': createHmac('sha256', secret).update(raw).digest('base64') }, body: raw });
  };
  const wooBody = { id: 20, status: 'processing', date_modified_gmt: new Date().toISOString(), line_items: [] };
  assert.equal((await wooSend('woo-order', wooBody)).status, 202);
  assert.equal((await wooSend('woo-order', wooBody)).status, 202);
  assert.equal((await wooSend('woo-order', { ...wooBody, id: 21 })).status, 409);
  const wooSettings = (await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2', [tenant, woo.id])).rows[0].settings;
  assert.ok(wooSettings.lastOrderWebhookAt);
  const foreignTenant = `${tenant}-foreign`;
  const foreignWoo = (await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,settings,encrypted_credentials,credential_iv,credential_tag) VALUES($1,'woocommerce','https://foreign.example','active','{}',$2,$3,$4) RETURNING id", [foreignTenant, sealed.encrypted, sealed.iv, sealed.tag])).rows[0];
  const foreignShop = (await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,status,settings,encrypted_credentials,credential_iv,credential_tag) VALUES($1,'shopify','foreign-fixture.myshopify.com','active','{}',$2,$3,$4) RETURNING id", [foreignTenant, sealed.encrypted, sealed.iv, sealed.tag])).rows[0];
  const foreignRaw = JSON.stringify({ id: 99, line_items: [], updated_at: new Date().toISOString() });
  const signature = createHmac('sha256', secret).update(foreignRaw).digest('base64');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const localShopResponse = await fetch(`${origin}/shopify/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-shop-domain': account.external_account_id, 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'local-http-delivery', 'x-shopify-hmac-sha256': signature }, body: foreignRaw });
  assert.equal(localShopResponse.status, 202, 'the configured tenant account still accepts a valid signed delivery');
  const foreignWooRequest = () => fetch(`${origin}/woocommerce/${foreignWoo.id}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-delivery-id': 'foreign-delivery', 'x-wc-webhook-signature': signature }, body: foreignRaw });
  const foreignShopRequest = () => fetch(`${origin}/shopify/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-shop-domain': 'foreign-fixture.myshopify.com', 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': 'foreign-delivery', 'x-shopify-hmac-sha256': signature }, body: foreignRaw });
  assert.equal((await foreignWooRequest()).status, 404, 'a genuine foreign-account signature does not authorize this tenant receiver');
  assert.equal((await foreignShopRequest()).status, 404);
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  try {
    assert.equal((await wooSend('missing-tenant', wooBody)).status, 503);
    assert.equal((await foreignShopRequest()).status, 503);
  } finally { process.env.INVENTORY_ALLOWED_TENANT_ID = tenant; }
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM ci_ingress WHERE tenant_id=$1', [foreignTenant])).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM ci_unified_order WHERE tenant_id=$1', [foreignTenant])).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM ci_outbox WHERE tenant_id=$1', [foreignTenant])).rows[0].count, 0);
  assert.deepEqual((await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2', [foreignTenant, foreignShop.id])).rows[0].settings, {});
  const bridgeSealed = sealCredential({ agentToken: 'controlled-foreign-token' });
  const foreignBridge = (await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,settings,encrypted_credentials,credential_iv,credential_tag) VALUES($1,'tally','foreign-bridge','{}',$2,$3,$4) RETURNING id", [foreignTenant, bridgeSealed.encrypted, bridgeSealed.iv, bridgeSealed.tag])).rows[0];
  const hash = value => createHash('sha256').update(value).digest('hex');
  const code = 'a'.repeat(32), state = 'b'.repeat(64), browser = 'c'.repeat(64);
  await db.query("INSERT INTO ci_agent_pairing(code_hash,tenant_id,account_id,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [hash(code), foreignTenant, foreignBridge.id]);
  const oauthSealed = sealCredential({ fields: { shop: 'fixture.invalid', clientSecret: secret, clientId: 'controlled-client' }, callback: 'https://fixture.invalid/callback' });
  await db.query("INSERT INTO ci_connection_oauth(state_hash,tenant_id,platform,browser_hash,encrypted_credentials,credential_iv,credential_tag,expires_at) VALUES($1,$2,'shopify',$3,$4,$5,$6,now()+interval '10 minutes')", [hash(state), foreignTenant, hash(browser), oauthSealed.encrypted, oauthSealed.iv, oauthSealed.tag]);
  const pairRequest = () => fetch(`${origin}/connections/agent/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const oauthQuery = { state, code: 'controlled-code', shop: 'fixture.invalid', timestamp: String(Math.floor(Date.now() / 1000)) };
  const oauthHmac = createHmac('sha256', secret).update(Object.keys(oauthQuery).sort().map(key => `${key}=${oauthQuery[key]}`).join('&')).digest('hex');
  const oauthRequest = () => fetch(`${origin}/connections/oauth/shopify/callback?${new URLSearchParams({ ...oauthQuery, hmac: oauthHmac })}`, { headers: { cookie: `dmills_oauth_${state.slice(0,12)}=${browser}` }, redirect: 'manual' });
  assert.equal((await pairRequest()).status, 400, 'a foreign-tenant pairing code cannot be consumed');
  assert.equal((await oauthRequest()).status, 400, 'foreign-tenant OAuth state cannot be consumed even with its browser cookie');
  assert.equal((await db.query('SELECT consumed_at FROM ci_agent_pairing WHERE code_hash=$1', [hash(code)])).rows[0].consumed_at, null);
  assert.equal((await db.query('SELECT consumed_at FROM ci_connection_oauth WHERE state_hash=$1', [hash(state)])).rows[0].consumed_at, null);
  const exportResponse = await fetch(`${origin}/connections/agent/export`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer controlled-foreign-token' }, body: JSON.stringify({ accountId: foreignBridge.id, xml: '<ENVELOPE />' }) });
  assert.equal(exportResponse.status, 401);
  assert.deepEqual((await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2', [foreignTenant, foreignBridge.id])).rows[0].settings, {});
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM ci_ingress WHERE tenant_id=$1', [foreignTenant])).rows[0].count, 0);
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  try { assert.equal((await pairRequest()).status, 503); assert.equal((await oauthRequest()).status, 503); }
  finally { process.env.INVENTORY_ALLOWED_TENANT_ID = tenant; }
  const query = db.query, connect = db.connect;
  try {
    for (const [code, status] of [['DATABASE_UNAVAILABLE', 503], ['DATABASE_TIMEOUT', 504]]) {
      db.query = async () => { throw Object.assign(new Error('private-db-detail'), { code }); };
      db.connect = async () => { throw Object.assign(new Error('private-db-detail'), { code }); };
      const response = await wooSend('dependency-failure', wooBody);
      assert.equal(response.status, status);
      assert.ok(!(await response.text()).includes('private-db-detail'));
      for (const request of [pairRequest, oauthRequest]) {
        const rejected = await request();
        assert.equal(rejected.status, status);
        assert.ok(!(await rejected.text()).includes('private-db-detail'));
      }
    }
  } finally { db.query = query; db.connect = connect; }
  console.log('PASS real disposable PG and HTTP public integration evidence: signed callbacks, unrelated topic, invalid identity, replay, foreign tenant/account, OAuth/agent state preservation, rollback and safe dependency 503/504.');
} finally { if (server) await new Promise(resolve => server.close(resolve)); await db.end(); }
