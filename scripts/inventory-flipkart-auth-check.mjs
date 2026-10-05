import { pathToFileURL } from 'node:url';
import { inventoryPool } from '../inventory/db.js';
import { openCredential } from '../inventory/credentials.js';
import { providerFetch } from '../inventory/connection-security.js';

const tokenUrl = 'https://api.flipkart.net/oauth-service/oauth/token';

async function attempt(name, url, options, fetcher) {
  try {
    const response = await fetcher(url, options);
    if (!response.ok) return { variant: name, result: 'failed', error: `http_${response.status}` };
    const body = await response.json().catch(() => null);
    if (!body || typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in))) {
      return { variant: name, result: 'failed', error: 'invalid_token_response' };
    }
    return { variant: name, result: 'success', expiresInSeconds: Number(body.expires_in) };
  } catch {
    // Never return provider exception text: URLs, headers, or response bodies may contain secrets.
    return { variant: name, result: 'failed', error: 'request_error_or_timeout' };
  }
}

export async function probeTokenVariants(fields, fetcher = providerFetch) {
  if (!fields || typeof fields.clientId !== 'string' || !fields.clientId || typeof fields.clientSecret !== 'string' || !fields.clientSecret) {
    throw new Error('vault_credentials_incomplete');
  }
  const authorization = `Basic ${Buffer.from(`${fields.clientId}:${fields.clientSecret}`).toString('base64')}`;
  const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'Seller_Api' });
  const headers = { Authorization: authorization };
  // Both variants use the same vault credentials and request a fresh token. Neither token is returned.
  const get = await attempt('GET', `${tokenUrl}?${params}`, { method: 'GET', headers }, fetcher);
  const post = await attempt('POST', tokenUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }, fetcher);
  return [get, post];
}

async function main() {
  const tenant = process.env.INVENTORY_ALLOWED_TENANT_ID;
  if (!tenant || !process.env.INVENTORY_DATABASE_URL || !process.env.INVENTORY_CREDENTIAL_KEY) {
    throw new Error('missing_inventory_configuration');
  }
  const db = inventoryPool();
  try {
    const accountId = process.env.INVENTORY_FLIPKART_ACCOUNT_ID;
    const query = accountId
      ? await db.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='flipkart' AND id=$2", [tenant, accountId])
      : await db.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='flipkart' LIMIT 2", [tenant]);
    if (query.rows.length !== 1) throw new Error(query.rows.length ? 'multiple_flipkart_accounts_select_id' : 'flipkart_account_not_found');
    const fields = openCredential(query.rows[0]);
    const results = await probeTokenVariants(fields);
    for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
    if (results.every(result => result.result === 'failed')) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const allowed = new Set(['missing_inventory_configuration', 'vault_credentials_incomplete', 'multiple_flipkart_accounts_select_id', 'flipkart_account_not_found']);
    process.stderr.write(`${JSON.stringify({ milestone: 'M0', result: 'stopped', error: allowed.has(error.message) ? error.message : 'vault_or_database_error' })}\n`);
    process.exitCode = 1;
  });
}
