import assert from 'node:assert/strict';
import { probeTokenVariants } from './inventory-flipkart-auth-check.mjs';

const calls = [];
const response = body => ({ ok: true, json: async () => body });
const results = await probeTokenVariants({ clientId: 'fixture-id', clientSecret: 'fixture-secret' }, async (url, options) => {
  calls.push({ url, options });
  return response({ access_token: 'fixture-token', expires_in: 3600 });
});
assert.deepEqual(results, [
  { variant: 'GET', result: 'success', expiresInSeconds: 3600 },
  { variant: 'POST', result: 'success', expiresInSeconds: 3600 },
]);
assert.equal(calls[0].options.method, 'GET');
assert.equal(new URL(calls[0].url).searchParams.get('grant_type'), 'client_credentials');
assert.equal(new URL(calls[0].url).searchParams.get('scope'), 'Seller_Api');
assert.equal(calls[1].options.method, 'POST');
assert.equal(new URLSearchParams(calls[1].options.body).get('grant_type'), 'client_credentials');
assert.equal(calls[0].options.headers.Authorization, calls[1].options.headers.Authorization);
assert.equal(JSON.stringify(results).includes('fixture-token'), false);
const failed = await probeTokenVariants({ clientId: 'fixture-id', clientSecret: 'fixture-secret' }, async (_url, options) => options.method === 'GET'
  ? { ok: false, status: 401 }
  : response({ access_token: 'fixture-token', expires_in: 3600 }));
assert.equal(failed[0].error, 'http_401');
assert.equal(failed[1].result, 'success');
console.log('PASS Flipkart auth probe: GET and POST requests, token redaction, sanitized HTTP failure (fixture-only)');
