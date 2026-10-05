import '../env.js';
import { stdin } from 'node:process';
import { inventoryPool } from '../inventory/db.js';
import { sealCredential } from '../inventory/credentials.js';

let input='';for await(const chunk of stdin){input+=chunk;if(input.length>100000)throw new Error('Account input too large');}
const {tenantId,platform,externalAccountId,credentials,scopes=[],settings={}}=JSON.parse(input);
if(!tenantId||!['shopify','amazon','blinkit','zepto','instamart','zoho-pos'].includes(platform)||!externalAccountId||!credentials||typeof credentials!=='object')throw new Error('Invalid account input');
if(tenantId!==process.env.INVENTORY_ALLOWED_TENANT_ID)throw new Error('Tenant is not configured');
const {encrypted,iv,tag}=sealCredential(credentials);
const result=await inventoryPool().query('INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,encrypted_credentials,credential_iv,credential_tag,scopes,settings,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,platform,external_account_id) DO UPDATE SET encrypted_credentials=$4,credential_iv=$5,credential_tag=$6,scopes=$7,settings=$8,status=$9 RETURNING id',[tenantId,platform,externalAccountId,encrypted,iv,tag,scopes,JSON.stringify(settings),'inactive']);
console.log(`Account ${result.rows[0].id} saved inactive; approve mappings and activate before syncing.`);await inventoryPool().end();
