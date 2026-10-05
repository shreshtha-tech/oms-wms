export async function load(url, context, nextLoad){
 const loaded=await nextLoad(url,context);
 if(!url.endsWith('/inventory/connection-provider.js')&&!url.endsWith('/inventory/connectors/shopify.js'))return loaded;
 const db=new URL(process.env.INVENTORY_DATABASE_URL||'');
 if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||!db.pathname.startsWith('/codexqa_test_'))throw new Error('Provider double requires an owned disposable database');
 let source=String(loaded.source);
 if(url.endsWith('/inventory/connectors/shopify.js')){
  source=source.replace('export class ShopifyConnector', 'class OriginalShopifyConnector');
  source+=`\nexport class ShopifyConnector {async readQuantity(listing){return listing==='fixture-match'?5:2;}}\n`;
  return {...loaded,source};
 }
 source=source.replace('export async function probeConnection(', 'async function originalProbeConnection(')
  .replace('export function shopifyClient(', 'function originalShopifyClient(');
 source+=`
 export async function probeConnection(platform,fields){return {fields,raw:{fixture:true},locations:[],skuCount:0};}
 export function shopifyClient(){return {graphql:async(query)=>query.includes('webhookSubscriptions')?{webhookSubscriptions:{nodes:[],pageInfo:{hasNextPage:false}}}:{orders:{nodes:[],pageInfo:{hasNextPage:false}}},createWebhookSubscription:async(topic,uri)=>({id:topic,topic,uri}),catalogProductPage:async()=>({nodes:[{variants:{nodes:[{sku:'AUDIT-FIXTURE',inventoryItem:{id:'fixture-catalog-item',tracked:true}}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}})};}
 `;
 return {...loaded,source};
}
