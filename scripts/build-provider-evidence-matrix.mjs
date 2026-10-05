import { writeFile, readFile } from 'node:fs/promises';
import { connectionCatalog } from '../inventory/connection-catalog.js';
const sources={shopify:'inventory/connectors/shopify.js; inventory/ingress.js; inventory/connection-provider.js',amazon:'inventory/connectors/amazon.js; inventory/ingress.js; inventory/connection-provider.js',amazon_fba:'inventory/connectors/amazon.js; inventory/connection-provider.js',woocommerce:'inventory/connection-provider.js; inventory/http.js',tally:'inventory/tally-bridge.js'};
const mapped=new Set(['shopify','amazon','woocommerce']);
const rows=connectionCatalog.map(provider=>({
 Provider:provider.name,providerKey:provider.key,
 'Credential mechanism':provider.auth,
 'Required credential types':provider.fields.filter(field=>field.secret).map(field=>field.label).join('; ')||'No API credentials are accepted for this approval/report workspace',
 'Required setup fields':provider.fields.filter(field=>field.required).map(field=>field.label).join('; '),
 'Required scopes':provider.scopes?.join('; ')||'UNKNOWN: not independently verified against an approved provider contract',
 'Account identity':provider.fields.filter(field=>['shop','sellerId','organizationId','storeUrl','accountId','company'].includes(field.key)).map(field=>field.label).join('; ')||'Exact provider account identity must be independently established',
 'Tenant mapping':'ci_channel_account.tenant_id; authenticated configured inventory tenant; provider ownership is a separate gate',
 'Channel mapping':'ci_channel_mapping tenant/account ownership; exact seller SKU and listing mapping required',
 'Warehouse/location mapping':'Internal location and exact provider location must be approved; imported observations do not create physical balances',
 'Webhook authentication':provider.key==='shopify'?'HMAC SHA256 with the exact app secret; durable webhook ID/hash':provider.key==='woocommerce'?'HMAC SHA256 with exact account webhook secret; durable delivery ID/hash':provider.key.startsWith('amazon')?'AWS-authorized SQS notification ingestion; not an unauthenticated HTTP seller callback':'UNKNOWN or not implemented; no live webhook proof',
 'Inventory read':mapped.has(provider.key)?'Implemented provider read path; configured provider evidence remains unverified':provider.auth==='approval'?'Report observations only; approved API contract missing':'Bounded configured sample/API or agent/report observation; full operational coverage unverified',
 'Inventory write':provider.write?'Declared connector write capability; requires authoritative stock, approved mappings, provider acknowledgement/readback and live evidence':provider.custody?'Custody observations only; physical warehouse inventory is not derived from these reports':'Disabled or contractually unverified',
 'Order read':provider.key==='shopify'?'Read-only observation and signed order webhooks implemented; configured evidence missing':provider.key==='amazon'?'Implemented order observation/notification paths; configured evidence missing':'Report/partial/unknown; inspect provider-specific approved contract before automation',
 'Fulfillment write':'Not independently proven for the configured provider; local order transitions do not establish provider fulfillment',
 'Return capability':provider.key==='shopify'?'Refund observations; full return/reverse fulfillment contract remains unverified':provider.key==='woocommerce'?'Refunded-order observations; physical returns remain separately gated':'Provider-specific returns contract and end-to-end proof missing',
 'Rate limits':'Local bounds exist; exact credential/account/operation quota must be verified against current approved provider contract',
 'Retry rules':'Safe reads only: bounded transient retry; no blind retry of auth/validation/permanent failures or uncertain writes; durable mutation identity/reconciliation required',
 'Readback mechanism':provider.key==='shopify'?'Inventory GraphQL quantity read; stale observations cannot overwrite newer state':provider.key==='woocommerce'?'Product quantity GET before/after write':provider.custody?'Custody/report reconciliation only; not physical stock proof':'Exact live acknowledgement and readback must be independently established',
 'Credential rotation':'Private encrypted vault/authorization mechanism where implemented; failure must not silently activate a replacement account',
 'Current evidence':'Repository contracts/declarations and explicitly controlled fixtures only; not genuine configured-provider proof',
 'Missing evidence':'Real authenticated and authorized account identity; correct tenant/channel/location; live read/write permission; registration/delivery/acknowledgement/readback/reconciliation as applicable',
 'Declared documentation':provider.docs,
 'Repository sources':sources[provider.key]||'inventory/connection-catalog.js; inventory/connection-provider.js; inventory/connections.js',
 'Evidence qualification':'Field/scopes above describe repository declarations, not newly verified provider contracts. UNKNOWN stays blocked; no secret values included.',
}));
for (const row of rows.filter(row=>['blinkit','zepto','instamart'].includes(row.providerKey))) {
 row['Inventory read']='Raw stock snapshot import returns 501 until an approved provider ordering contract exists; partner report workspace observations remain separately scoped';
 row['Missing evidence']+='; exact approved snapshot schema, authoritative generation timestamp/revision and reconciliation rules';
 row['Repository sources']+='; inventory/partner-file.js';
}
try {
 const live=JSON.parse(await readFile('tmp/mongo-reliability/configured-shopify-readonly-2026-10-04.json','utf8'));
 const row=rows.find(row=>row.providerKey==='shopify');
 const matches=live.accounts.filter(account=>account.authenticated&&account.identityMatched);
 row['Current evidence']=`${matches.length} configured accounts passed real client-credentials authentication and exact shop-identity/scope reads on ${live.at}. No writes, activation or persistence.`;
 row['Missing evidence']='Operation-specific authorization including read_locations requirement, legitimate physical locations/stock, approved SKU/channel/location mappings, subscriptions/delivery, mutation acknowledgement and quantity readback/reconciliation';
 row['Evidence qualification']='Repository capability declarations remain separate from fresh REAL_PROVIDER authentication/identity/scope evidence in tmp/mongo-reliability/configured-shopify-readonly-2026-10-04.json. Other providers remain unverified.';
} catch {}
await writeFile('docs/reliability/provider-evidence-matrix.json',JSON.stringify({date:'2026-10-04',productionReady:false,completion:'UNPROVEN',rows},null,2)+'\n');
const columns=Object.keys(rows[0]);const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
await writeFile('docs/reliability/provider-evidence-matrix.csv',[columns,...rows.map(row=>columns.map(key=>row[key]))].map(row=>row.map(quote).join(',')).join('\n')+'\n');
console.log('Recorded',rows.length,'provider rows with explicit missing live evidence; no credential values.');
