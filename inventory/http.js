import { readTenantBalances } from './balance-read.js';
import { inventoryTenantBoundary } from './tenant-boundary.js';
import { decodeStockSnapshotUpload } from './snapshot-upload.js';
import { recordOrderWebhookEvidence, validateWebhookOrderIdentity } from './webhook-evidence.js';
import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { inventoryPool } from './db.js';
import { openCredential } from './credentials.js';
import { acceptShopifyWebhook } from './ingress.js';
import { inventoryDrift } from './workers.js';
import { ingestPartnerStockFile } from './partner-file.js';
import { centralInventoryApi } from './central-api.js';
import { sellerConnectionsApi, sellerOAuthApi } from './connections.js';
import { ShopifyConnector } from './connectors/shopify.js';
import { transaction } from './db.js';
import { createHash } from 'node:crypto';
import { recordIncomingOrder, recordReturn, unifiedOrdersApi } from './unified-orders.js';
import { whatsappPublic } from './whatsapp.js';

export const inventoryPublic=express.Router(),inventoryPrivate=express.Router();
inventoryPublic.use('/connections',sellerOAuthApi);
inventoryPublic.use('/whatsapp',whatsappPublic);
inventoryPublic.post('/woocommerce/:accountId/webhook',express.raw({type:()=>true,limit:'2mb'}),async(req,res)=>{
 try{
  const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
  if(!tenantId)return res.status(503).json({error:'Inventory tenant is not configured'});
  const row=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND platform='woocommerce'",[tenantId,req.params.accountId])).rows[0];
  if(!row)return res.status(404).json({error:'Unknown WooCommerce connection'});
  const fields=openCredential(row),topic=String(req.get('x-wc-webhook-topic')||'');
  // WooCommerce sends an unsigned form-encoded ping when registering a webhook.
  if(!topic&&req.is('application/x-www-form-urlencoded')&&/^webhook_id=\d+$/.test(req.body.toString()))return res.status(200).json({received:true});
  if(!ShopifyConnector.verifyWebhook(req.body,req.get('x-wc-webhook-signature'),fields.webhookSecret))return res.status(401).json({error:'Invalid WooCommerce signature'});
  const observeOnly=row.status!=='active'&&row.settings?.orderObservationEnabled===true;
  if(row.status!=='active'&&!observeOnly)return res.status(409).json({error:'Connection is not configured for order intake'});
  if(!['order.created','order.updated',...(row.status==='active'?['product.updated']:[])].includes(topic))return res.status(400).json({error:'Unsupported WooCommerce topic'});
  const id=String(req.get('x-wc-webhook-delivery-id')||'');if(!id)return res.status(400).json({error:'Missing delivery ID'});
  const payload=JSON.parse(req.body);if(topic.startsWith('order.'))validateWebhookOrderIdentity(payload);const event=topic==='product.updated'?{id:payload.id,sku:payload.sku,stock_quantity:payload.stock_quantity}:{id:payload.id,status:payload.status,providerUpdatedAt:payload.date_modified_gmt||payload.date_modified||null,line_items:payload.line_items?.map(line=>({id:line.id,sku:line.sku,quantity:line.quantity,product_id:line.product_id,variation_id:line.variation_id}))};
  const digest=createHash('sha256').update(req.body).digest('hex');
  await transaction(async db=>{const result=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id',[row.tenant_id,`woocommerce:${row.id}`,id,digest]);if(!result.rowCount){const old=(await db.query('SELECT payload_hash FROM ci_ingress WHERE tenant_id=$1 AND source=$2 AND message_id=$3',[row.tenant_id,`woocommerce:${row.id}`,id])).rows[0];if(old.payload_hash!==digest)throw Object.assign(new Error('Delivery replay has different content'),{status:409});return;}if(topic.startsWith('order.'))await recordIncomingOrder(db,{tenantId:row.tenant_id,accountId:row.id,platform:'woocommerce',event:payload,topic,packingAlerts:!observeOnly});await recordOrderWebhookEvidence(db,{tenantId:row.tenant_id,accountId:row.id,platform:'woocommerce',topic});if(payload.status==='refunded')await recordReturn(db,{tenantId:row.tenant_id,accountId:row.id,platform:'woocommerce',event:{id:`order-${payload.id}`,order_id:payload.id,status:'refunded'}});if(!observeOnly)await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload) VALUES($1,$2,'woocommerce_ingress',$3)",[row.tenant_id,row.id,JSON.stringify({topic,event})]);});
  res.status(202).json({received:true});
 }catch(error){if(sendDatabaseError(res,error))return;res.status(error?.status===409?409:400).json({error:'WooCommerce webhook could not be accepted'});}
});
inventoryPublic.post('/shopify/webhook',express.raw({type:'application/json',limit:'2mb'}),async(req,res)=>{
  try{
    const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
    if(!tenantId)return res.status(503).json({error:'Inventory tenant is not configured'});
    const shop=String(req.get('x-shopify-shop-domain')||''),topic=String(req.get('x-shopify-topic')||'');
    const matches=await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' AND external_account_id=$2 AND (status='active' OR (verified_at IS NOT NULL AND settings->>'orderObservationEnabled'='true'))",[tenantId,shop]);
    if(matches.rowCount!==1)return res.status(404).json({error:'Unknown Shopify account'});
    const account=matches.rows[0],secret=openCredential(account);
    if(account.status!=='active'&&!['orders/create','orders/updated','orders/cancelled','refunds/create'].includes(topic))return res.status(409).json({error:'Read-only connection accepts order observations only'});
    const result=await acceptShopifyWebhook({tenantId:account.tenant_id,accountId:account.id,topic,messageId:req.get('x-shopify-webhook-id'),rawBody:req.body,hmac:req.get('x-shopify-hmac-sha256'),secret:secret.webhookSecret||secret.clientSecret,observeOnly:account.status!=='active'});
    return res.status(202).json(result);
  }catch(error){if(sendDatabaseError(res,error))return;return res.status(error.status||500).json({error:error.status?error.message:'Inventory webhook unavailable'});}
});
inventoryPrivate.use(inventoryTenantBoundary);
inventoryPrivate.use('/central',centralInventoryApi);
inventoryPrivate.use('/connections',sellerConnectionsApi);
inventoryPrivate.use('/unified',unifiedOrdersApi);
// Ledger events must originate in a workflow that validates the business
// transition and owns its request key. No external event-ingest contract exists.
inventoryPrivate.post('/events',(_req,res)=>res.status(501).json({error:'Direct inventory events are unavailable; use an approved count, receipt, transfer, order, or return workflow.'}));
inventoryPrivate.get('/balances',async(req,res)=>{try{res.json(await readTenantBalances(inventoryPool(),req.inventoryTenantId));}catch(error){if(error?.code==='BALANCE_RESULT_LIMIT')return res.status(413).json({error:error.code,message:error.message});if(sendDatabaseError(res,error))return;res.status(503).json({error:'Inventory database unavailable'});}});
inventoryPrivate.get('/drift',async(req,res)=>{try{res.json(await inventoryDrift(req.inventoryTenantId));}catch{res.status(503).json({error:'Inventory database unavailable'});}});
inventoryPrivate.post('/partner-stock-file',async(req,res)=>{try{const {accountId}=req.body;const upload=decodeStockSnapshotUpload(req.body);res.status(202).json(await ingestPartnerStockFile({tenantId:req.inventoryTenantId,accountId,...upload}));}catch(error){if(error?.code==='SNAPSHOT_ORDERING_CONTRACT_UNVERIFIED')return res.status(501).json({error:error.code,message:'Partner stock snapshot import is unavailable until an approved provider ordering contract is established.'});if(sendDatabaseError(res,error))return;res.status(400).json({error:'Stock snapshot could not be accepted. Verify the file format and approved account/SKU/location mappings.'});}});
