import '../env.js';
import { inventoryPool, transaction } from '../inventory/db.js';
import { openCredential } from '../inventory/credentials.js';
import { ShopifyConnector } from '../inventory/connectors/shopify.js';

const tenant=process.env.INVENTORY_ALLOWED_TENANT_ID,shop=process.env.INVENTORY_SHOPIFY_DOMAIN;
if(!tenant||!shop)throw new Error('Inventory tenant and Shopify domain required');
const db=inventoryPool();
const accountResult=await db.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND external_account_id=$2",[tenant,shop]);
if(accountResult.rowCount!==1)throw new Error('Verified Shopify account not found');
const account=accountResult.rows[0],secret=openCredential(account),connector=new ShopifyConnector({shop,clientId:secret.clientId,clientSecret:secret.clientSecret,token:secret.accessToken});
const variants=new Map(),duplicates=new Set(),locations=[];
let cursor=null,productCount=0,variantCount=0,skipped=0;
for(let pageNumber=0;pageNumber<1000;pageNumber++){
  const page=await connector.catalogProductPage(cursor);
  for(const product of page.nodes){
    productCount++;
    let variantsPage=product.variants;
    for(let variantPageNumber=0;variantPageNumber<100;variantPageNumber++){
      for(const variant of variantsPage.nodes){
        variantCount++;
        const sku=String(variant.sku||'').trim();
        if(!sku||!variant.inventoryItem?.tracked){skipped++;continue;}
        if(variants.has(sku)){duplicates.add(sku);continue;}
        variants.set(sku,{name:product.title,inventoryItemId:variant.inventoryItem.id});
      }
      if(!variantsPage.pageInfo.hasNextPage)break;
      if(variantPageNumber===99)throw new Error('Variant pagination exceeded safe limit');
      variantsPage=await connector.catalogVariantPage(product.id,variantsPage.pageInfo.endCursor);
      if(!variantsPage)throw new Error('Product disappeared during catalog discovery');
    }
  }
  if(!page.pageInfo.hasNextPage)break;
  if(pageNumber===999)throw new Error('Product pagination exceeded safe limit');
  cursor=page.pageInfo.endCursor;
}
cursor=null;
for(let pageNumber=0;pageNumber<100;pageNumber++){
  const page=await connector.catalogLocationPage(cursor);
  locations.push(...page.nodes.map(x=>x.id));
  if(!page.pageInfo.hasNextPage)break;
  if(pageNumber===99)throw new Error('Location pagination exceeded safe limit');
  cursor=page.pageInfo.endCursor;
}
let staged=0,alreadyMapped=0;
await transaction(async client=>{
  for(const [sku,variant] of variants){
    if(duplicates.has(sku))continue;
    let product=await client.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,sku) DO NOTHING RETURNING id',[tenant,sku,variant.name]);
    if(!product.rowCount)product=await client.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2',[tenant,sku]);
    for(const locationId of locations){
      const inserted=await client.query('INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,active) VALUES($1,$2,$3,$4,$5,$6,false) ON CONFLICT(tenant_id,account_id,external_sku,external_location_id) DO NOTHING RETURNING id',[tenant,account.id,product.rows[0].id,sku,variant.inventoryItemId,locationId]);
      if(inserted.rowCount)staged++;else alreadyMapped++;
    }
  }
});
console.log(JSON.stringify({shop,productsRead:productCount,variantsRead:variantCount,trackedSkuCandidates:variants.size,skippedUntrackedOrMissingSku:skipped,duplicateSkuCount:duplicates.size,locationCount:locations.length,pendingMappingsStaged:staged,existingMappingsUntouched:alreadyMapped,accountStatus:account.status},null,2));
await db.end();
