import '../env.js';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { refreshShopifySnapshot } from '../inventory/shopify-snapshot.js';
import { openCredential } from '../inventory/credentials.js';
import { ShopifyConnector } from '../inventory/connectors/shopify.js';
import { mkdir,writeFile } from 'node:fs/promises';
const db=inventoryPool();
try{
  await migrateInventory();
  const tenant=process.env.INVENTORY_ALLOWED_TENANT_ID;
  const account=(await db.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND external_account_id=$2",[tenant,process.env.INVENTORY_SHOPIFY_DOMAIN])).rows[0];
  if(!account)throw new Error('The configured Shopify account is not registered');
  console.log(JSON.stringify(await refreshShopifySnapshot(tenant,account.id),null,2));
  const sample=(await db.query("SELECT * FROM ci_stock_observation WHERE tenant_id=$1 AND account_id=$2 AND match_status='matched' AND (quantities->>'on_hand')::bigint>=5 ORDER BY sku LIMIT 1",[tenant,account.id])).rows[0];
  if(sample){
    const secret=openCredential(account),connector=new ShopifyConnector({shop:account.external_account_id,clientId:secret.clientId,clientSecret:secret.clientSecret,token:secret.accessToken});
    const readback=await connector.readQuantity(sample.external_item_id,sample.external_location_id);
    if(readback!==sample.quantities.available)throw new Error('Shopify sample changed during verification; refresh again');
    await mkdir('artifacts/central-inventory',{recursive:true});
    await writeFile('artifacts/central-inventory/shopify-verified-sample.json',JSON.stringify({sku:sample.sku,...sample.quantities,shop:account.external_account_id,locationId:sample.external_location_id,observedAt:sample.observed_at,readbackVerified:true},null,2));
    console.log(JSON.stringify({sampleSku:sample.sku,available:readback,onHand:sample.quantities.on_hand,readbackVerified:true}));
  }
}finally{await db.end();}
