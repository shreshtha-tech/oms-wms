import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionAuthorizationSetup } from '../inventory/connections.js';

const keys = ['INVENTORY_PUBLIC_ORIGIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'AMAZON_SP_API_APPLICATION_ID'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
try {
  for (const key of keys) delete process.env[key];
  let setup = connectionAuthorizationSetup();
  assert.equal(setup.shopify.available, false);
  assert.equal(setup.shopify.callbackUrl, null);
  assert.ok(setup.shopify.missing.some(value => value.includes('HTTPS')));
  process.env.INVENTORY_PUBLIC_ORIGIN = 'https://inventory.example.com';
  process.env.SHOPIFY_CLIENT_ID = 'fixture-app-id';
  process.env.SHOPIFY_CLIENT_SECRET = 'fixture-app-secret';
  process.env.AMAZON_SP_API_APPLICATION_ID = 'fixture-amazon-id';
  setup = connectionAuthorizationSetup();
  assert.equal(setup.shopify.available, true);
  assert.equal(setup.shopify.callbackUrl, 'https://inventory.example.com/api/inventory-sync/connections/oauth/shopify/callback');
  assert.equal(setup.amazon_fba.available, true);
  assert.equal(setup.amazon_fba.callbackUrl, 'https://inventory.example.com/api/inventory-sync/connections/oauth/amazon_fba/callback');
  assert.equal(JSON.stringify(setup).includes('fixture-app-secret'), false);
  const render = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
  const webService = render.split('  - type: worker')[0];
  assert.match(webService, /- key: AMAZON_SP_API_APPLICATION_ID\n\s+sync: false/,
    'Render web service must accept the Amazon SP-API application id used to start seller authorization');
  process.env.INVENTORY_PUBLIC_ORIGIN = 'http://localhost:5173';
  assert.equal(connectionAuthorizationSetup().shopify.available, false);
  console.log('PASS authorization setup: exact HTTPS callbacks and provider-specific deployment prerequisites');
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}
