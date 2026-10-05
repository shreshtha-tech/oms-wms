import { recordOrderWebhookEvidence, validateWebhookOrderIdentity } from './webhook-evidence.js';
import { createHash } from 'node:crypto';
import { transaction } from './db.js';
import { ShopifyConnector } from './connectors/shopify.js';
import { recordIncomingOrder, recordReturn } from './unified-orders.js';

export async function acceptShopifyWebhook({tenantId,accountId,topic,messageId,rawBody,hmac,secret,observeOnly=false}){
  if(!ShopifyConnector.verifyWebhook(rawBody,hmac,secret))throw Object.assign(new Error('Invalid Shopify webhook signature'),{status:401});
  if(!['orders/create','orders/updated','orders/cancelled','inventory_levels/update','refunds/create'].includes(topic))throw Object.assign(new Error('Unsupported Shopify topic'),{status:400});
  if(!messageId)throw Object.assign(new Error('Missing webhook ID'),{status:400});
  let parsed;try{parsed=JSON.parse(rawBody.toString());}catch{throw Object.assign(new Error('Invalid webhook JSON'),{status:400});}
  if(topic.startsWith('orders/'))validateWebhookOrderIdentity(parsed);
  const hash=createHash('sha256').update(rawBody).digest('hex');
  const event=topic.startsWith('orders/')?{id:parsed.id,status:parsed.status,created_at:parsed.created_at,updated_at:parsed.updated_at,cancelled_at:parsed.cancelled_at,shipping_address:{city:parsed.shipping_address?.city,zip:parsed.shipping_address?.zip},current_total_price:parsed.current_total_price,currency:parsed.currency,line_items:parsed.line_items?.map(line=>({id:line.id,sku:line.sku,quantity:line.quantity,title:line.title}))}:
    topic==='refunds/create'?{id:parsed.id,order_id:parsed.order_id,status:parsed.status,reason:parsed.reason}:
    {inventory_item_id:parsed.inventory_item_id,location_id:parsed.location_id,available:parsed.available,updated_at:parsed.updated_at};
  return transaction(async db=>{
    const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[tenantId,`shopify:${accountId}`,messageId,hash]);
    if(!receipt.rowCount){const old=await db.query('SELECT payload_hash FROM ci_ingress WHERE tenant_id=$1 AND source=$2 AND message_id=$3',[tenantId,`shopify:${accountId}`,messageId]);if(old.rows[0]?.payload_hash!==hash)throw Object.assign(new Error('Webhook ID replayed with changed body'),{status:409});return {duplicate:true};}
    if(topic.startsWith('orders/'))await recordIncomingOrder(db,{tenantId,accountId,platform:'shopify',event,topic,packingAlerts:!observeOnly});
    await recordOrderWebhookEvidence(db,{tenantId,accountId,platform:'shopify',topic});
    if(topic==='refunds/create')await recordReturn(db,{tenantId,accountId,platform:'shopify',event});
    if(!observeOnly&&topic!=='orders/updated')await db.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,payload) VALUES($1,'shopify_ingress',$2,$3)",[tenantId,accountId,JSON.stringify({topic,messageId,event})]);return {duplicate:false};
  });
}
export async function acceptAmazonNotification({tenantId,accountId,notification}){
  const type=notification.NotificationType,id=notification.NotificationMetadata?.NotificationId;
  if(!['ORDER_CHANGE','LISTINGS_ITEM_MFN_QUANTITY_CHANGE'].includes(type)||!id)throw new Error('Unsupported Amazon notification');
  const hash=createHash('sha256').update(JSON.stringify(notification)).digest('hex');
  return transaction(async db=>{const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[tenantId,`amazon:${accountId}`,id,hash]);if(!receipt.rowCount){const old=await db.query('SELECT payload_hash FROM ci_ingress WHERE tenant_id=$1 AND source=$2 AND message_id=$3',[tenantId,`amazon:${accountId}`,id]);if(old.rows[0]?.payload_hash!==hash)throw Object.assign(new Error('Amazon notification ID replayed with changed body'),{status:409});return {duplicate:true};}if(type==='ORDER_CHANGE')await recordIncomingOrder(db,{tenantId,accountId,platform:'amazon',event:notification,topic:type});await db.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,payload) VALUES($1,'amazon_ingress',$2,$3)",[tenantId,accountId,JSON.stringify(notification)]);return {duplicate:false};});
}
