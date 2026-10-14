import { inventoryPool, transaction } from './db.js';
import { createHash } from 'node:crypto';
import { currentCredentials } from './connection-setup.js';
import { shopifyClient } from './connection-provider.js';
import { recordIncomingOrder } from './unified-orders.js';
import { tryLogSyncAttempt, safeAccountFailure, safeProviderStatus } from './sync-attempts.js';

const query=`query($cursor:String,$filter:String!){orders(first:50,after:$cursor,query:$filter,sortKey:UPDATED_AT){nodes{id legacyResourceId createdAt updatedAt cancelledAt displayFulfillmentStatus currentTotalPriceSet{shopMoney{amount currencyCode}} shippingAddress{city zip} lineItems(first:100){nodes{id sku quantity name}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}`;

export function normalizeShopifyOrderObservation(order) {
 const legacyId=typeof order?.legacyResourceId==='string'?order.legacyResourceId:Number.isSafeInteger(order?.legacyResourceId)?String(order.legacyResourceId):'';
 if(!/^[0-9]{1,120}$/.test(legacyId))throw new Error('Shopify order observation lacks a stable numeric order identity');
 if(typeof order.updatedAt!=='string'||!Number.isFinite(Date.parse(order.updatedAt)))throw new Error('Shopify order observation lacks a provider update revision');
 if(typeof order.displayFulfillmentStatus!=='string'||!order.displayFulfillmentStatus)throw new Error('Shopify order observation lacks fulfillment status');
 if(!order.lineItems || !Array.isArray(order.lineItems.nodes) || typeof order.lineItems.pageInfo?.hasNextPage!=='boolean')throw new Error('Shopify order observation lacks a complete line connection');
 if(order.lineItems.pageInfo.hasNextPage)throw new Error('An order has more than 100 lines; order observation halted for review');
 const lineItems=order.lineItems.nodes.map(line=>{
  const id=String(line?.id??'').split('/').pop();
  if(!id||typeof line?.sku!=='string'||!line.sku||!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw new Error('Shopify order observation has an incomplete physical line');
  return {id,sku:line.sku,quantity:line.quantity,title:line.name};
 });
 return {id:legacyId,status:order.cancelledAt?'cancelled':order.displayFulfillmentStatus,created_at:order.createdAt,updated_at:order.updatedAt,cancelled_at:order.cancelledAt,current_total_price:order.currentTotalPriceSet?.shopMoney?.amount,currency:order.currentTotalPriceSet?.shopMoney?.currencyCode,shipping_address:order.shippingAddress,line_items:lineItems};
}

export async function pollShopifyOrderObservations(tenantId,{clientFactory=shopifyClient}={}){
 const accounts=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND settings->>'orderObservationEnabled'='true'",[tenantId])).rows;
 const summary={accounts:0,orders:0,errors:[]};
 for(const account of accounts){
  try{
   const scanHighWater=new Date();
   const cursor=(await inventoryPool().query("SELECT last_success_at,failure_count,retry_after FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenantId,account.id])).rows[0];
   if(cursor?.retry_after&&new Date(cursor.retry_after)>new Date())continue;
   const since=new Date((cursor?.last_success_at?.getTime()||Date.now()-30*86400000)-5*60000).toISOString();
   const filter=`updated_at:>=${since}`;
   const connector=clientFactory(await currentCredentials(account));let after=null,count=0;
   for(let page=0;page<100;page++){
    const result=(await connector.graphql(query,{cursor:after,filter},100)).orders;
    if(!result?.pageInfo||!Array.isArray(result.nodes))throw new Error('Shopify order page is incomplete');
    for(const order of result.nodes){
     const normalized=normalizeShopifyOrderObservation(order);
     await transaction(async db=>{
      const source=`shopify:${account.id}`,messageId=`poll:${normalized.id}:${normalized.updated_at}`;
      const digest=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[tenantId,source,messageId,digest]);
      if(!receipt.rowCount){
       const previous=(await db.query('SELECT payload_hash FROM ci_ingress WHERE tenant_id=$1 AND source=$2 AND message_id=$3',[tenantId,source,messageId])).rows[0];
       if(previous?.payload_hash!==digest)throw new Error('Shopify poll revision replayed with changed content');
      }
      const persisted=await recordIncomingOrder(db,{tenantId,accountId:account.id,platform:'shopify',event:normalized,topic:'poll_observed',packingAlerts:account.status==='active'});
      if(!persisted)throw new Error('Shopify order observation was not durably accepted');
     });
     count++;
    }
    if(!result.pageInfo.hasNextPage)break;
    if(page===99)throw new Error('Shopify order observation exceeded 5,000 orders; narrow the interval');
    after=result.pageInfo.endCursor;
   }
   await inventoryPool().query("INSERT INTO ci_sync_cursor(tenant_id,account_id,stream,last_success_at,failure_count,retry_after) VALUES($1,$2,'shopify_order_observation',$3,0,NULL) ON CONFLICT(tenant_id,account_id,stream) DO UPDATE SET last_success_at=GREATEST(coalesce(ci_sync_cursor.last_success_at,$3),$3),failure_count=0,retry_after=NULL",[tenantId,account.id,scanHighWater]);
   await inventoryPool().query("UPDATE ci_channel_account SET connection_state='verified',verified_at=coalesce(verified_at,now()),settings=settings||jsonb_build_object('lastOrderObservationAt',now()),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,account.id]);
   await tryLogSyncAttempt({tenantId,accountId:account.id,direction:'read',operation:'shopify_order_observation',skuCount:count,diagnostic:{orders:count,readOnly:true}});
   summary.accounts++;summary.orders+=count;
  }catch(error){summary.errors.push({accountId:account.id,error:'Order observation failed; diagnostic details unavailable'});await inventoryPool().query("INSERT INTO ci_sync_cursor(tenant_id,account_id,stream,failure_count,retry_after) VALUES($1,$2,'shopify_order_observation',1,now()+make_interval(secs=>5*(0.5+random()*0.5))) ON CONFLICT(tenant_id,account_id,stream) DO UPDATE SET failure_count=least(ci_sync_cursor.failure_count+1,5),retry_after=now()+make_interval(secs=>least(60,5*power(2,least(ci_sync_cursor.failure_count,4))::integer)*(0.5+random()*0.5))",[tenantId,account.id]);await inventoryPool().query("UPDATE ci_channel_account SET connection_state=CASE WHEN $3=401 THEN 'token_expired' ELSE 'error' END,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,account.id,safeProviderStatus(error)]);const safe=await safeAccountFailure(tenantId,account.id,error);summary.errors[summary.errors.length-1].error=safe.message;await tryLogSyncAttempt({tenantId,accountId:account.id,direction:'read',operation:'shopify_order_observation',status:'failed',diagnostic:safe});}
 }
 return summary;
}
