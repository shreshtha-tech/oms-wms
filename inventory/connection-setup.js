import { inventoryPool, transaction } from './db.js';
import { openCredential, sealCredential } from './credentials.js';
import { shopifyClient, refreshProviderToken, wooRequest } from './connection-provider.js';
import { tryLogSyncAttempt } from './sync-attempts.js';

export async function currentCredentials(account,{forceRefresh=false,fetcher}={}){
 const old=openCredential(account);
 // Serialize rotating refresh tokens across web/worker processes.
 return transaction(async db=>{
  const row=(await db.query('SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[account.tenant_id,account.id])).rows[0];
  if(!row)throw new Error('Connection no longer exists');
  const previous=openCredential(row);
  if(account.platform==='shopify'){previous.shop=row.external_account_id;previous.apiVersion||='2026-07';}
  if(forceRefresh)previous.expiresAt=1;
  const fields=await refreshProviderToken(account.platform,previous,fetcher);
  if(fields!==previous){const sealed=sealCredential(fields);await db.query('UPDATE ci_channel_account SET encrypted_credentials=$3,credential_iv=$4,credential_tag=$5 WHERE tenant_id=$1 AND id=$2',[account.tenant_id,account.id,sealed.encrypted,sealed.iv,sealed.tag]);}
  return fields||old;
 });
}
export async function discoverConnectionCatalog(account){
 const fields=await currentCredentials(account),variants=new Map(),duplicates=new Set();let skipped=0;
 const add=(sku,listingId)=>{if(!sku){skipped++;return;}if(variants.has(sku)){duplicates.add(sku);return;}variants.set(sku,listingId);};
 if(account.platform==='shopify'){
  const connector=shopifyClient(fields);let cursor=null;
  for(let pageNumber=0;pageNumber<1000;pageNumber++){
   const page=await connector.catalogProductPage(cursor);
   for(const product of page.nodes){let variantsPage=product.variants;
    for(let index=0;index<1000;index++){for(const variant of variantsPage.nodes){if(!variant.inventoryItem?.tracked){skipped++;continue;}add(String(variant.sku||''),variant.inventoryItem.id);}
     if(!variantsPage.pageInfo.hasNextPage)break;if(index===999)throw new Error('Variant pagination limit reached');variantsPage=await connector.catalogVariantPage(product.id,variantsPage.pageInfo.endCursor);if(!variantsPage)throw new Error('Product disappeared during discovery');}
   }
   if(!page.pageInfo.hasNextPage)break;if(pageNumber===999)throw new Error('Product pagination limit reached');cursor=page.pageInfo.endCursor;
  }
 }else if(account.platform==='woocommerce'){
  for(let page=1;page<=1000;page++){const products=await wooRequest(fields,`/products?per_page=100&page=${page}`);for(const product of products){if(product.type==='variable'){
   for(let vp=1;vp<=1000;vp++){const variations=await wooRequest(fields,`/products/${product.id}/variations?per_page=100&page=${vp}`);for(const variant of variations){if(variant.manage_stock===true)add(variant.sku,`${product.id}/variations/${variant.id}`);else skipped++;}if(variations.length<100)break;if(vp===1000)throw new Error('Variation pagination limit reached');}
  }else if(product.manage_stock===true)add(product.sku,String(product.id));else skipped++;}if(products.length<100)break;if(page===1000)throw new Error('Product pagination limit reached');}
 }else throw new Error('Automatic catalog discovery is available for Shopify and WooCommerce; use explicit mapping for this provider');
 let staged=0,unmatched=0;const discoveredMappingIds=[];
 await transaction(async db=>{
  const locations=(await db.query('SELECT * FROM ci_connection_location WHERE tenant_id=$1 AND account_id=$2',[account.tenant_id,account.id])).rows;
  if(!locations.length)throw new Error('Map a provider location before importing SKU mappings');
  await db.query('UPDATE ci_channel_mapping SET active=false,approved_at=NULL WHERE tenant_id=$1 AND account_id=$2',[account.tenant_id,account.id]);
  for(const [sku,listing]of variants){if(duplicates.has(sku))continue;const master=(await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2',[account.tenant_id,sku])).rows[0];if(!master){unmatched++;continue;}
   for(const location of locations){const r=await db.query('INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,listing_id,external_location_id,internal_location_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,account_id,external_sku,external_location_id) DO UPDATE SET master_sku_id=EXCLUDED.master_sku_id,listing_id=EXCLUDED.listing_id,internal_location_id=EXCLUDED.internal_location_id,active=false,approved_at=NULL RETURNING id',[account.tenant_id,account.id,master.id,sku,listing,location.external_location_id,location.internal_location_id]);staged+=r.rowCount;discoveredMappingIds.push(r.rows[0].id);}
  }
  await db.query("UPDATE ci_channel_account SET status='inactive',settings=settings||jsonb_build_object('discoveredMappingIds',$3::jsonb) WHERE tenant_id=$1 AND id=$2",[account.tenant_id,account.id,JSON.stringify(discoveredMappingIds)]);
 });
 const result={staged,unmatched,skipped,duplicateSkus:[...duplicates].slice(0,100)};
 await tryLogSyncAttempt({tenantId:account.tenant_id,accountId:account.id,direction:'read',operation:'catalog_mapping',skuCount:staged,diagnostic:result});return result;
}
export async function provisionWebhooks(account,origin){
 const fields=await currentCredentials(account),target=`${origin}/api/inventory-sync/${account.platform==='shopify'?'shopify/webhook':`woocommerce/${account.id}/webhook`}`,created=[];
 if(account.platform==='shopify'){
  if(!fields.webhookSecret&&!fields.clientSecret)throw new Error('Save the app client secret before provisioning Shopify webhooks');
  const client=shopifyClient(fields);let cursor=null,subscriptions=[];
  do{const page=(await client.graphql('query($cursor:String){webhookSubscriptions(first:100,after:$cursor){nodes{id topic uri}pageInfo{hasNextPage endCursor}}}',{cursor})).webhookSubscriptions;subscriptions.push(...page.nodes);cursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;if(subscriptions.length>10000)throw new Error('Too many webhook subscriptions');}while(cursor);
  const topics=account.status==='active'?['ORDERS_CREATE','ORDERS_UPDATED','ORDERS_CANCELLED','REFUNDS_CREATE','INVENTORY_LEVELS_UPDATE']:['ORDERS_CREATE','ORDERS_UPDATED','ORDERS_CANCELLED','REFUNDS_CREATE'];
  for(const topic of topics)created.push(subscriptions.find(s=>s.topic===topic&&s.uri===target)||await client.createWebhookSubscription(topic,target));
 }else if(account.platform==='woocommerce'){
  if(!fields.webhookSecret){fields.webhookSecret=crypto.randomUUID()+crypto.randomUUID();const sealed=sealCredential(fields);await inventoryPool().query('UPDATE ci_channel_account SET encrypted_credentials=$3,credential_iv=$4,credential_tag=$5 WHERE tenant_id=$1 AND id=$2',[account.tenant_id,account.id,sealed.encrypted,sealed.iv,sealed.tag]);}
  const existing=await wooRequest(fields,'/webhooks?per_page=100');
  const topics=account.status==='active'?['order.created','order.updated','product.updated']:['order.created','order.updated'];
  for(const topic of topics){const found=existing.find(w=>w.topic===topic&&w.delivery_url===target);created.push(found?await wooRequest(fields,`/webhooks/${found.id}`,{method:'PUT',body:{secret:fields.webhookSecret,status:'active'}}):await wooRequest(fields,'/webhooks',{method:'POST',body:{name:`D-Mills ${topic}`,topic,delivery_url:target,secret:fields.webhookSecret,status:'active'}}));}
 }else throw new Error('This provider uses its separately approved notification/queue interface');
 await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[account.tenant_id,account.id,JSON.stringify({webhooksReady:true,webhookTarget:target,webhookIds:created.map(w=>w.id)})]);
 await tryLogSyncAttempt({tenantId:account.tenant_id,accountId:account.id,direction:'setup',operation:'webhooks_registered',diagnostic:{count:created.length}});return {registered:created.length,target};
}
export async function activateConnection(account,mappingIds){
 if(!['shopify','woocommerce'].includes(account.platform))throw new Error('Automatic publication is not enabled for this provider until its complete intake/readback contract is verified');
 if(!account.verified_at||Date.now()-new Date(account.verified_at).getTime()>24*3600000)throw new Error('Retest the credentials before activation');
 if(!account.settings.webhooksReady)throw new Error('Provision order/inventory webhooks before activation');
 if(!Array.isArray(mappingIds)||!mappingIds.length||mappingIds.length>5000)throw new Error('Select the SKU mappings to activate');
 const discovered=new Set(account.settings.discoveredMappingIds||[]);
 if(mappingIds.some(id=>!discovered.has(id)))throw new Error('Rediscover the catalog; selected mappings are not in the latest verified catalog');
 // Existing open orders need a reconciled reservation baseline before initial publication.
 const fields=await currentCredentials(account);
 if(account.platform==='shopify'){
  const result=await shopifyClient(fields).graphql('query{orders(first:1,query:"status:open"){nodes{id}}}');
  if(!Array.isArray(result.orders?.nodes))throw new Error('Could not verify the open-order baseline');
  if(result.orders.nodes.length)throw new Error('Activation blocked: existing open Shopify orders require reservation reconciliation before initial stock publication');
 }else{
  for(const status of ['pending','processing','on-hold']){
   const orders=await wooRequest(fields,`/orders?per_page=1&status=${status}`);
   if(!Array.isArray(orders))throw new Error('Could not verify the open-order baseline');
   if(orders.length)throw new Error('Activation blocked: existing open WooCommerce orders require reservation reconciliation before initial stock publication');
  }
 }
 const tenant=account.tenant_id;
 return transaction(async db=>{
  const mappings=(await db.query("SELECT m.*,b.version,l.location_type FROM ci_channel_mapping m JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id JOIN ci_location l ON l.tenant_id=m.tenant_id AND l.id=m.internal_location_id WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.id=ANY($3::uuid[]) FOR UPDATE OF m,b",[tenant,account.id,mappingIds])).rows;
  if(mappings.length!==new Set(mappingIds).size||mappings.some(m=>Number(m.version)<1||!['warehouse','store'].includes(m.location_type)))throw new Error('Every selected mapping needs verified physical warehouse/store stock');
  const duplicates=new Set();for(const m of mappings){if(duplicates.has(m.external_sku))throw new Error('Multi-location order allocation is not configured; select one location per seller SKU');duplicates.add(m.external_sku);}
  await db.query('UPDATE ci_channel_mapping SET active=false WHERE tenant_id=$1 AND account_id=$2',[tenant,account.id]);
  await db.query('UPDATE ci_channel_mapping SET active=true,approved_at=now() WHERE tenant_id=$1 AND account_id=$2 AND id=ANY($3::uuid[])',[tenant,account.id,mappingIds]);
  await db.query("UPDATE ci_channel_account SET status='active',connection_state='verified',updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,account.id]);
  for(const m of mappings)await db.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4)",[tenant,account.id,m.id,JSON.stringify({source:'connection_activation',at:new Date().toISOString()})]);
  return {activated:mappings.length};
 });
}
