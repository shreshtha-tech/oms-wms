import { ShopifyConnector } from './connectors/shopify.js';
import { AmazonConnector } from './connectors/amazon.js';
import { providerFetch, jsonResponse } from './connection-security.js';

export const amazonOrigins={fe:'https://sellingpartnerapi-fe.amazon.com',eu:'https://sellingpartnerapi-eu.amazon.com',na:'https://sellingpartnerapi-na.amazon.com'};
export async function refreshProviderToken(platform,fields,fetcher=providerFetch){
 if(fields.accessToken&&(!fields.expiresAt||Date.now()<Number(fields.expiresAt)-60000))return fields;
 if(platform==='shopify'&&!fields.refreshToken)return fields;
 let url,body,headers={'Content-Type':'application/x-www-form-urlencoded'};
 if(platform==='shopify'){url=`https://${fields.shop}/admin/oauth/access_token`;body={grant_type:'refresh_token',refresh_token:fields.refreshToken,client_id:fields.clientId,client_secret:fields.clientSecret};}
 else if(platform==='flipkart'){
  // Official self-access flow: GET with Basic authentication, no form body.
  const response=await fetcher('https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api',{method:'GET',headers:{Authorization:`Basic ${Buffer.from(`${fields.clientId}:${fields.clientSecret}`).toString('base64')}`}});
  const data=await jsonResponse(response,platform);
  if(!data.access_token)throw Object.assign(new Error('Provider did not issue an access token'),{providerStatus:401});
  return {...fields,accessToken:data.access_token,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};
 }
 else if(platform==='zoho_pos'){url=`https://accounts.zoho.${fields.region}/oauth/v2/token`;body={grant_type:'refresh_token',refresh_token:fields.refreshToken,client_id:fields.clientId,client_secret:fields.clientSecret};}
 else return fields;
 const data=await jsonResponse(await fetcher(url,{method:'POST',headers,body:new URLSearchParams(body).toString()}),platform);
 if(!data.access_token)throw Object.assign(new Error('Provider did not issue an access token'),{providerStatus:401,diagnostic:data});
 return {...fields,accessToken:data.access_token,refreshToken:data.refresh_token||fields.refreshToken,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};
}
export function shopifyClient(fields,fetcher=providerFetch){return new ShopifyConnector({shop:fields.shop,token:fields.accessToken,clientId:fields.refreshToken?undefined:fields.clientId,clientSecret:fields.refreshToken?undefined:fields.clientSecret,apiVersion:fields.apiVersion||'2026-07',fetcher});}
export async function wooRequest(fields,path,{method='GET',body,fetcher=providerFetch}={}) {
 const response=await fetcher(`${fields.storeUrl}/wp-json/wc/v3${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(`${fields.consumerKey}:${fields.consumerSecret}`).toString('base64')}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 return jsonResponse(response,'WooCommerce');
}
export async function probeConnection(platform,input,{fetcher=providerFetch}={}) {
 const fields=await refreshProviderToken(platform,input,fetcher);
 if(platform==='shopify'){
  const connector=shopifyClient(fields,fetcher);
  const raw=await connector.graphql('query{shop{id name myshopifyDomain}currentAppInstallation{accessScopes{handle}}products(first:1){nodes{id title variants(first:1){nodes{id sku inventoryItem{id tracked}}}}}locations(first:50){nodes{id name}pageInfo{hasNextPage endCursor}}}');
  if(raw.shop?.myshopifyDomain!==fields.shop)throw new Error('Shopify returned a different shop identity');
  const scopes=raw.currentAppInstallation?.accessScopes?.map(scope=>scope.handle)||[];
  const missing=['read_products','read_inventory','write_inventory','read_orders','read_locations'].filter(scope=>!scopes.includes(scope));
  if(missing.length)throw new Error(`Shopify app is missing scopes: ${missing.join(', ')}`);
  const locations=[...raw.locations.nodes];let page=raw.locations.pageInfo;
  while(page.hasNextPage){const next=await connector.graphql('query($cursor:String!){locations(first:100,after:$cursor){nodes{id name}pageInfo{hasNextPage endCursor}}}',{cursor:page.endCursor});locations.push(...next.locations.nodes);page=next.locations.pageInfo;if(locations.length>10000)throw new Error('Location catalog exceeds verification limit');}
  return {fields,raw,locations,scopes,skuCount:raw.products.nodes.length};
 }
 if(platform==='amazon'||platform==='amazon_fba'){
  const connector=new AmazonConnector({...fields,endpoint:amazonOrigins[fields.region],fetcher});
  const raw=platform==='amazon_fba'?await connector.getFbaInventory():await connector.request(`/listings/2021-08-01/items/${encodeURIComponent(fields.sellerId)}/${encodeURIComponent(fields.testSku)}?marketplaceIds=${encodeURIComponent(fields.marketplaceId)}&includedData=fulfillmentAvailability,summaries`);
  if(platform==='amazon'&&raw.sku!==fields.testSku)throw new Error('Amazon did not return the requested seller SKU');
  if(platform==='amazon_fba'&&!Array.isArray(raw.payload?.inventorySummaries))throw new Error('Amazon FBA response did not contain inventory summaries');
  const locations=platform==='amazon_fba'?[{id:fields.marketplaceId,name:'Amazon custody'}]:[...new Set((Array.isArray(raw.fulfillmentAvailability)?raw.fulfillmentAvailability:[])
    .map(item=>typeof item.fulfillmentChannelCode==='string'?item.fulfillmentChannelCode.trim():'').filter(Boolean))]
    .map(code=>({id:code,name:code}));
  return {fields,raw,locations,scopes:[],skuCount:platform==='amazon_fba'?raw.payload.inventorySummaries.length:1};
 }
 if(platform==='woocommerce'){
  const raw=await wooRequest(fields,'/products?per_page=1',{fetcher});
  if(!Array.isArray(raw))throw new Error('WooCommerce products response is not a list');
  return {fields,raw,locations:[{id:'store',name:'WooCommerce stock pool'}],scopes:[],skuCount:raw.length};
 }
 if(platform==='flipkart'){
  const raw=await jsonResponse(await fetcher(`https://api.flipkart.net/sellers/listings/v3/${encodeURIComponent(fields.testSku)}`,{headers:{Authorization:`Bearer ${fields.accessToken}`}}),'Flipkart');
  if(!raw.available?.[fields.testSku])throw new Error('Flipkart did not return the requested seller SKU');
  const locations=(raw.available[fields.testSku].locations||[]).map(location=>({id:location.id,name:location.id}));
  return {fields,raw,locations,scopes:[],skuCount:1};
 }
 if(platform==='snapdeal'){
  const raw=await jsonResponse(await fetcher(`https://apigateway.snapdeal.com/seller-api/products/inventory/bulk?supcs=${encodeURIComponent(fields.supc)}`,{headers:{clientId:fields.clientId,'X-Auth-Token':fields.authToken,'X-Seller-Authz-Token':fields.sellerToken}}),'Snapdeal');
  if(!Array.isArray(raw.payload)||!raw.payload.some(item=>item.supc===fields.supc))throw new Error('Snapdeal did not return the requested SUPC');
  return {fields,raw,locations:[{id:'seller',name:'Seller inventory'}],scopes:[],skuCount:raw.payload.length};
 }
 if(platform==='zoho_pos'){
  const raw=await jsonResponse(await fetcher(`https://api.zakya.${fields.region}/inventory/v1/items?organization_id=${encodeURIComponent(fields.organizationId)}&per_page=1`,{headers:{Authorization:`Zoho-oauthtoken ${fields.accessToken}`}}),'Zoho POS');
  if(raw.code!==0||!Array.isArray(raw.items))throw Object.assign(new Error('Zoho POS did not return item data'),{diagnostic:raw});
  return {fields,raw,locations:[{id:fields.organizationId,name:'POS organization (map store before adjustments)'}],scopes:[],skuCount:raw.items.length};
 }
 throw new Error('This channel requires a partner-approved feed or local agent; API verification is unavailable');
}
