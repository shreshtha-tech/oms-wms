import { providerFetch } from '../connection-security.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export class ShopifyConnector {
  constructor({shop,token,clientId,clientSecret,apiVersion='2026-07',fetcher=providerFetch,rateControl}) {
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))throw new Error('Invalid Shopify shop domain');
    this.shop=shop;this.url=`https://${shop}/admin/api/${apiVersion}/graphql.json`;this.token=token;this.clientId=clientId;this.clientSecret=clientSecret;this.tokenExpires=0;this.fetcher=fetcher;this.rateControl=rateControl;this.available=0;this.restoreRate=100;this.updatedAt=Date.now();
  }
  async accessToken(){
    if(this.token&&(!this.clientId||Date.now()<this.tokenExpires-60000))return this.token;
    if(!this.clientId||!this.clientSecret)throw new Error('Shopify client credentials or access token required');
    const response=await this.fetcher(`https://${this.shop}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.clientSecret,grant_type:'client_credentials'}),signal:AbortSignal.timeout(20000)});
    if(!response.ok){
      const body=await response.text();
      let payload={};try{payload=JSON.parse(body)}catch{}
      const rawCode=payload.error||body.match(/<title[^>]*>\s*400 - Oauth error ([a-z_]+)\s*<\/title>/i)?.[1];
      const code=typeof rawCode==='string'&&/^[a-z_]+$/.test(rawCode)?` ${rawCode}`:'';
      throw new Error(`Shopify token request failed (${response.status}${code})`);
    }
    const data=await response.json();if(typeof data.access_token!=='string'||!data.access_token)throw new Error('Shopify returned an invalid token response');this.token=data.access_token;this.tokenExpires=Date.now()+Number(data.expires_in)*1000;return this.token;
  }
  static verifyWebhook(rawBody,header,secret) {
    if(!header||!secret)return false;
    const expected=createHmac('sha256',secret).update(rawBody).digest();
    const received=Buffer.from(header,'base64');
    return received.length===expected.length&&timingSafeEqual(received,expected);
  }
  async graphql(query,variables={},estimatedCost=20) {
    if(this.rateControl)await this.rateControl(estimatedCost);
    const elapsed=(Date.now()-this.updatedAt)/1000;this.available=Math.min(this.restoreRate*10,this.available+elapsed*this.restoreRate);
    if(this.available<estimatedCost)await new Promise(r=>setTimeout(r,Math.ceil((estimatedCost-this.available)/this.restoreRate*1000)));
    const response=await this.fetcher(this.url,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':await this.accessToken()},body:JSON.stringify({query,variables}),retrySafe: /^\s*query\b/.test(query),signal:AbortSignal.timeout(20000)});
    const data=await response.json();if(!response.ok||data.errors?.length)throw Object.assign(new Error(`Shopify API failure (${response.status})`),{providerStatus:response.status,diagnostic:data.errors||data});
    if(!data.data || typeof data.data!=='object')throw new Error('Shopify returned an invalid data response');
    const throttle=data.extensions?.cost?.throttleStatus;
    if(throttle){this.available=throttle.currentlyAvailable;this.restoreRate=throttle.restoreRate;this.updatedAt=Date.now();}
    else this.available=Math.max(0,this.available-estimatedCost);
    return data.data;
  }
  async readQuantity(inventoryItemId,locationId){
    const data=await this.graphql('query($id:ID!){inventoryItem(id:$id){inventoryLevels(first:100){nodes{location{id}quantities(names:["available"]){name quantity}}}}}',{id:inventoryItemId});
    return data?.inventoryItem?.inventoryLevels?.nodes?.find(x=>x.location.id===locationId)?.quantities?.find(x=>x.name==='available')?.quantity??null;
  }
  async setQuantity({inventoryItemId,locationId,quantity,compareQuantity,referenceDocumentUri,idempotencyKey}){
    if(!Number.isSafeInteger(quantity)||quantity<0||!Number.isSafeInteger(compareQuantity))throw new TypeError('Quantity and compareQuantity are required integers');
    const query='mutation($input:InventorySetQuantitiesInput!,$idempotencyKey:String!){inventorySetQuantities(input:$input) @idempotent(key:$idempotencyKey){userErrors{field message}inventoryAdjustmentGroup{createdAt}}}';
    const data=await this.graphql(query,{input:{name:'available',reason:'correction',referenceDocumentUri,quantities:[{inventoryItemId,locationId,quantity,changeFromQuantity:compareQuantity}]},idempotencyKey},30);
    const errors=data.inventorySetQuantities?.userErrors||[];if(errors.length)throw new Error(`Shopify inventory rejected: ${JSON.stringify(errors)}`);
    return data.inventorySetQuantities;
  }
  async createWebhookSubscription(topic,uri){
    if(!['ORDERS_CREATE','ORDERS_CANCELLED','REFUNDS_CREATE','INVENTORY_LEVELS_UPDATE'].includes(topic))throw new TypeError('Unsupported inventory webhook topic');
    if(!/^https:\/\/[^/]+\//.test(uri))throw new TypeError('Webhook URI must be public HTTPS');
    const query='mutation($topic:WebhookSubscriptionTopic!,$subscription:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$subscription){webhookSubscription{id topic uri}userErrors{field message}}}';
    const data=await this.graphql(query,{topic,subscription:{uri}},20),result=data.webhookSubscriptionCreate;
    if(result.userErrors?.length)throw new Error(`Shopify webhook subscription rejected: ${JSON.stringify(result.userErrors)}`);
    return result.webhookSubscription;
  }
  async discoverCatalog({productCursor=null,locationCursor=null}={}){
    const query='query($productCursor:String,$locationCursor:String){shop{id name}locations(first:50,after:$locationCursor){nodes{id}pageInfo{hasNextPage endCursor}}products(first:50,after:$productCursor){nodes{id title variants(first:100){nodes{id sku inventoryItem{id tracked}}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}';
    return this.graphql(query,{productCursor,locationCursor},100);
  }
  async catalogProductPage(cursor=null){
    return (await this.graphql('query($cursor:String){products(first:10,after:$cursor){nodes{id title variants(first:20){nodes{id sku inventoryItem{id tracked}}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}',{cursor},100)).products;
  }
  async catalogVariantPage(productId,cursor){
    return (await this.graphql('query($id:ID!,$cursor:String!){product(id:$id){variants(first:50,after:$cursor){nodes{id sku inventoryItem{id tracked}}pageInfo{hasNextPage endCursor}}}}',{id:productId,cursor},75)).product?.variants;
  }
  async catalogLocationPage(cursor=null){
    return (await this.graphql('query($cursor:String){locations(first:50,after:$cursor){nodes{id}pageInfo{hasNextPage endCursor}}}',{cursor},30)).locations;
  }
  async inventoryPage(cursor=null){
    return (await this.graphql('query($cursor:String){inventoryItems(first:30,after:$cursor){nodes{id sku tracked inventoryLevels(first:10){nodes{location{id}quantities(names:["on_hand","available","committed","reserved","damaged","quality_control","safety_stock"]){name quantity}}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}',{cursor},400)).inventoryItems;
  }
  async inventoryLevelPage(id,cursor){
    return (await this.graphql('query($id:ID!,$cursor:String!){inventoryItem(id:$id){inventoryLevels(first:50,after:$cursor){nodes{location{id}quantities(names:["on_hand","available","committed","reserved","damaged","quality_control","safety_stock"]){name quantity}}pageInfo{hasNextPage endCursor}}}}',{id,cursor},100)).inventoryItem?.inventoryLevels;
  }
}
