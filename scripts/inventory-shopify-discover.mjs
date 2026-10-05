import '../env.js';
import { inventoryPool } from '../inventory/db.js';
import { openCredential } from '../inventory/credentials.js';
import { ShopifyConnector } from '../inventory/connectors/shopify.js';
const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID,shop=process.env.INVENTORY_SHOPIFY_DOMAIN;
if(!tenantId||!shop)throw new Error('INVENTORY_ALLOWED_TENANT_ID and INVENTORY_SHOPIFY_DOMAIN required');
const db=inventoryPool(),result=await db.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND external_account_id=$2",[tenantId,shop]);
if(result.rowCount!==1)throw new Error('Registered Shopify account not found');
const secret=openCredential(result.rows[0]),connector=new ShopifyConnector({shop,clientId:secret.clientId,clientSecret:secret.clientSecret,token:secret.accessToken});
if(process.argv.includes('--probe')){
  const data=await connector.graphql('query{shop{id name}products(first:10){nodes{id title variants(first:10){nodes{sku inventoryItem{id tracked}}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}locations(first:10){nodes{id}pageInfo{hasNextPage}}}',{},50);
  const sample=data.products.nodes.flatMap(p=>p.variants.nodes.map(v=>({product:p.title,sku:v.sku,tracked:v.inventoryItem.tracked,inventoryItemId:v.inventoryItem.id}))).find(v=>v.sku&&v.tracked);
  const available=sample?await connector.readQuantity(sample.inventoryItemId,data.locations.nodes[0]?.id):null;
  console.log(JSON.stringify({shop:data.shop,productPageSize:data.products.nodes.length,productsMore:data.products.pageInfo.hasNextPage,locations:data.locations.nodes,locationsMore:data.locations.pageInfo.hasNextPage,skuSample:sample?{...sample,availableAtFirstLocation:available}:null,productsWithTruncatedVariants:data.products.nodes.filter(p=>p.variants.pageInfo.hasNextPage).map(p=>p.title)},null,2));
  await db.end();process.exit(0);
}
const data=await connector.discoverCatalog();
let productCursor=data.products.pageInfo.endCursor;
let locationCursor=data.locations.pageInfo.endCursor;
for(let page=1;data.products.pageInfo.hasNextPage;page++){
  if(page>=100)throw new Error('Shopify product discovery exceeded 100 pages');
  const next=await connector.discoverCatalog({productCursor});
  data.products.nodes.push(...next.products.nodes);
  data.products.pageInfo=next.products.pageInfo;
  productCursor=next.products.pageInfo.endCursor;
}
for(let page=1;data.locations.pageInfo.hasNextPage;page++){
  if(page>=100)throw new Error('Shopify location discovery exceeded 100 pages');
  const next=await connector.discoverCatalog({locationCursor});
  data.locations.nodes.push(...next.locations.nodes);
  data.locations.pageInfo=next.locations.pageInfo;
  locationCursor=next.locations.pageInfo.endCursor;
}
if(process.argv.includes('--summary')){
  const variants=data.products.nodes.flatMap(p=>p.variants.nodes.map(v=>({product:p.title,sku:v.sku,inventoryItemId:v.inventoryItem.id,tracked:v.inventoryItem.tracked})));
  const named=variants.filter(v=>v.sku);
  const stock=[];
  for(const variant of named){
    const quantities=[];
    for(const location of data.locations.nodes)quantities.push({locationId:location.id,available:await connector.readQuantity(variant.inventoryItemId,location.id)});
    stock.push({...variant,quantities});
  }
  console.log(JSON.stringify({shop:data.shop,productCount:data.products.nodes.length,variantCount:variants.length,variantsWithSku:named.length,variantsWithoutSku:variants.length-named.length,productsTruncated:data.products.pageInfo.hasNextPage,locationsTruncated:data.locations.pageInfo.hasNextPage,locations:data.locations.nodes,stock},null,2));
  await db.end();process.exit(0);
}
console.log(JSON.stringify({shop:data.shop,locations:data.locations.nodes,products:data.products.nodes.map(p=>({id:p.id,title:p.title,variants:p.variants.nodes.map(v=>({id:v.id,sku:v.sku,inventoryItemId:v.inventoryItem.id,tracked:v.inventoryItem.tracked})),variantsTruncated:p.variants.pageInfo.hasNextPage})),productsTruncated:data.products.pageInfo.hasNextPage,locationsTruncated:data.locations.pageInfo.hasNextPage},null,2));
await db.end();
