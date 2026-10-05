import { inventoryPool, transaction } from './db.js';
import { currentCredentials } from './connection-setup.js';
import { shopifyClient } from './connection-provider.js';
import { recordIncomingOrder } from './unified-orders.js';
import { tryLogSyncAttempt, safeAccountFailure, safeProviderStatus } from './sync-attempts.js';

const query=`query($cursor:String,$filter:String!){orders(first:50,after:$cursor,query:$filter,sortKey:UPDATED_AT){nodes{id legacyResourceId createdAt updatedAt cancelledAt displayFulfillmentStatus currentTotalPriceSet{shopMoney{amount currencyCode}} shippingAddress{city zip} lineItems(first:100){nodes{id sku quantity name}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}`;

export async function pollShopifyOrderObservations(tenantId){
 const accounts=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND settings->>'orderObservationEnabled'='true'",[tenantId])).rows;
 const summary={accounts:0,orders:0,errors:[]};
 for(const account of accounts){
  try{
   const cursor=(await inventoryPool().query("SELECT last_success_at,failure_count,retry_after FROM ci_sync_cursor WHERE tenant_id=$1 AND account_id=$2 AND stream='shopify_order_observation'",[tenantId,account.id])).rows[0];
   if(cursor?.retry_after&&new Date(cursor.retry_after)>new Date())continue;
   const since=new Date((cursor?.last_success_at?.getTime()||Date.now()-30*86400000)-5*60000).toISOString();
   const filter=`updated_at:>=${since}`;
   const connector=shopifyClient(await currentCredentials(account));let after=null,count=0;
   for(let page=0;page<100;page++){
    const result=(await connector.graphql(query,{cursor:after,filter},100)).orders;
    if(!result?.pageInfo||!Array.isArray(result.nodes))throw new Error('Shopify order page is incomplete');
    for(const order of result.nodes){
     if(order.lineItems?.pageInfo?.hasNextPage)throw new Error('An order has more than 100 lines; order observation halted for review');
     const normalized={id:order.legacyResourceId,status:order.cancelledAt?'cancelled':order.displayFulfillmentStatus,created_at:order.createdAt,updated_at:order.updatedAt,cancelled_at:order.cancelledAt,current_total_price:order.currentTotalPriceSet?.shopMoney?.amount,currency:order.currentTotalPriceSet?.shopMoney?.currencyCode,shipping_address:order.shippingAddress,line_items:order.lineItems?.nodes?.map(line=>({id:String(line.id).split('/').pop(),sku:line.sku,quantity:line.quantity,title:line.name}))||[]};
     await transaction(db=>recordIncomingOrder(db,{tenantId,accountId:account.id,platform:'shopify',event:normalized,topic:'poll_observed',packingAlerts:account.status==='active'}));count++;
    }
    if(!result.pageInfo.hasNextPage)break;
    if(page===99)throw new Error('Shopify order observation exceeded 5,000 orders; narrow the interval');
    after=result.pageInfo.endCursor;
   }
   await inventoryPool().query("INSERT INTO ci_sync_cursor(tenant_id,account_id,stream,last_success_at,failure_count,retry_after) VALUES($1,$2,'shopify_order_observation',now(),0,NULL) ON CONFLICT(tenant_id,account_id,stream) DO UPDATE SET last_success_at=now(),failure_count=0,retry_after=NULL",[tenantId,account.id]);
   await inventoryPool().query("UPDATE ci_channel_account SET connection_state='verified',verified_at=coalesce(verified_at,now()),settings=settings||jsonb_build_object('lastOrderObservationAt',now()),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,account.id]);
   await tryLogSyncAttempt({tenantId,accountId:account.id,direction:'read',operation:'shopify_order_observation',skuCount:count,diagnostic:{orders:count,readOnly:true}});
   summary.accounts++;summary.orders+=count;
  }catch(error){summary.errors.push({accountId:account.id,error:'Order observation failed; diagnostic details unavailable'});await inventoryPool().query("INSERT INTO ci_sync_cursor(tenant_id,account_id,stream,failure_count,retry_after) VALUES($1,$2,'shopify_order_observation',1,now()+interval '5 seconds') ON CONFLICT(tenant_id,account_id,stream) DO UPDATE SET failure_count=least(ci_sync_cursor.failure_count+1,5),retry_after=now()+make_interval(secs=>least(60,5*power(2,least(ci_sync_cursor.failure_count,4))::integer))",[tenantId,account.id]);await inventoryPool().query("UPDATE ci_channel_account SET connection_state=CASE WHEN $3=401 THEN 'token_expired' ELSE 'error' END,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,account.id,safeProviderStatus(error)]);const safe=await safeAccountFailure(tenantId,account.id,error);summary.errors[summary.errors.length-1].error=safe.message;await tryLogSyncAttempt({tenantId,accountId:account.id,direction:'read',operation:'shopify_order_observation',status:'failed',diagnostic:safe});}
 }
 return summary;
}
