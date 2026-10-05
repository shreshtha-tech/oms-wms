import '../env.js';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { sealCredential } from '../inventory/credentials.js';
import { ShopifyConnector } from '../inventory/connectors/shopify.js';

const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
const shop=process.env.INVENTORY_SHOPIFY_DOMAIN;
const clientId=process.env.SHOPIFY_CLIENT_ID;
const clientSecret=process.env.SHOPIFY_CLIENT_SECRET;
if(!tenantId||!shop||!clientId||!clientSecret)throw new Error('Set INVENTORY_ALLOWED_TENANT_ID, INVENTORY_SHOPIFY_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the private environment');

const connector=new ShopifyConnector({shop,clientId,clientSecret});
const response=await connector.graphql('query{shop{id name}currentAppInstallation{accessScopes{handle}}}');
if(!response.shop?.id)throw new Error('Shopify app did not return an authorized shop');
const granted=new Set(response.currentAppInstallation?.accessScopes?.map(x=>x.handle)||[]);
const required=['read_products','read_inventory','write_inventory','read_orders'];
const missing=required.filter(x=>!granted.has(x));
if(missing.length)throw new Error(`Shopify app lacks required scopes: ${missing.join(', ')}`);

await migrateInventory();
const sealed=sealCredential({clientId,clientSecret});
const result=await inventoryPool().query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,encrypted_credentials,credential_iv,credential_tag,scopes,status) VALUES($1,'shopify',$2,$3,$4,$5,$6,'inactive') ON CONFLICT(tenant_id,platform,external_account_id) DO UPDATE SET encrypted_credentials=$3,credential_iv=$4,credential_tag=$5,scopes=$6,status='inactive' RETURNING id",[tenantId,shop,sealed.encrypted,sealed.iv,sealed.tag,[...granted]]);
console.log(`Verified Shopify shop ${response.shop.name} (${response.shop.id}); encrypted account ${result.rows[0].id} saved inactive.`);
await inventoryPool().end();
