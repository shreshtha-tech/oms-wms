import express from 'express';
import { transaction, inventoryPool } from './db.js';
import { returnOptions, approveReturnReceipt } from './return-service.js';
import { connectionCatalog } from './connection-catalog.js';
import { whatsappReady, whatsappSetup } from './whatsapp.js';
import { connectionReadiness } from './connection-readiness.js';
import { providerFetch } from './connection-security.js';
import { requestRecipientOtp, verifyRecipientOtp, otpConfigured } from './recipient-otp.js';

const clean=(value,max=160)=>value==null?null:String(value).slice(0,max);
const timestamp=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value):null;

export async function recordIncomingOrder(db,{tenantId,accountId,platform,event,topic,notify=true,packingAlerts=true}){
 const source=platform==='amazon'?event?.Payload?.OrderChangeNotification:event;
 const summary=platform==='amazon'?source?.Summary:null;
 const externalId=clean(platform==='amazon'?source?.AmazonOrderId:source?.id,120);
 if(!externalId)return null;
 const cancelled=topic==='orders/cancelled'||Boolean(source?.cancelled_at)||['cancelled','failed','Canceled'].includes(summary?.OrderStatus||source?.status);
 const providerStatus=clean(summary?.OrderStatus||source?.status||topic,60);
 const city=clean(source?.shipping_address?.city||source?.shipping?.city,120);
 const pincode=clean(source?.shipping_address?.zip||source?.shipping?.postcode,20);
 const amount=Number(source?.current_total_price??source?.total);
 const safeAmount=Number.isFinite(amount)&&amount>=0?amount:null;
 const revision=timestamp(source?.OrderChangeTrigger?.TimeOfOrderChange||source?.date_modified_gmt||source?.date_modified||source?.updated_at||source?.updatedAt||source?.LastUpdateDate);
 const orderedAt=timestamp(source?.created_at||source?.date_created);
 const freshForAlert=!orderedAt||orderedAt.getTime()>=Date.now()-2*60*60*1000;
 const result=await db.query(`INSERT INTO ci_unified_order(tenant_id,account_id,platform,external_order_id,provider_status,work_status,ordered_at,dispatch_by,city,pincode,amount,currency,payment_mode,provider_updated_at)
 VALUES($1,$2,$3,$4,$5,'new',$6,$7,$8,$9,$10,$11,$12,$13)
 ON CONFLICT(tenant_id,account_id,external_order_id) DO UPDATE SET provider_status=EXCLUDED.provider_status,updated_at=now(),provider_updated_at=coalesce(EXCLUDED.provider_updated_at,ci_unified_order.provider_updated_at),city=coalesce(EXCLUDED.city,ci_unified_order.city),pincode=coalesce(EXCLUDED.pincode,ci_unified_order.pincode),amount=coalesce(EXCLUDED.amount,ci_unified_order.amount)
 WHERE ci_unified_order.provider_updated_at IS NULL OR EXCLUDED.provider_updated_at IS NULL OR EXCLUDED.provider_updated_at>=ci_unified_order.provider_updated_at
 RETURNING id,first_seen_at`,[tenantId,accountId,platform,externalId,providerStatus,orderedAt,timestamp(source?.fulfill_by),city,pincode,safeAmount,clean(source?.currency,8),clean(source?.payment_gateway_names?.join(',')||source?.payment_method,80),revision]);
 if(!result.rowCount)return null;
 const orderId=result.rows[0].id;
 if(cancelled)await db.query("UPDATE ci_order_alert SET status='cancelled' WHERE tenant_id=$1 AND order_id=$2 AND status='pending'",[tenantId,orderId]);
 const lines=platform==='amazon'?summary?.OrderItems:source?.line_items;
 for(const line of Array.isArray(lines)?lines:[]){
  const lineId=clean(platform==='amazon'?line.OrderItemId:line.id,120),sku=clean(platform==='amazon'?line.SellerSKU:line.sku,120),quantity=Number(platform==='amazon'?line.Quantity:line.quantity);
  if(!lineId||!sku||!Number.isSafeInteger(quantity)||quantity<=0)continue;
  const stockBound=(await db.query(`SELECT 1 FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4
   UNION ALL SELECT 1 FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4 LIMIT 1`,[tenantId,`${platform}:${accountId}`,externalId,lineId])).rowCount>0;
  if(stockBound){
   const prior=(await db.query('SELECT seller_sku,quantity FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=$2 AND external_line_id=$3',[tenantId,orderId,lineId])).rows[0];
   if(prior&&(prior.seller_sku!==sku||prior.quantity!==quantity)){
    await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'line_change_requires_review',$4) ON CONFLICT DO NOTHING`,[tenantId,orderId,`${platform}:${accountId}:${externalId}:${lineId}:changed:${revision?.toISOString()||quantity}`,JSON.stringify({lineId,providerSku:sku,providerQuantity:quantity,reservedQuantity:prior.quantity})]);
    continue;
   }
  }
  await db.query(`INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,quantity,title)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,order_id,external_line_id) DO UPDATE SET seller_sku=EXCLUDED.seller_sku,quantity=EXCLUDED.quantity,title=EXCLUDED.title`,[tenantId,orderId,lineId,sku,quantity,clean(line.title||line.name,250)]);
 }
 if(revision){await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'provider_updated',$4) ON CONFLICT DO NOTHING`,[tenantId,orderId,`${platform}:${accountId}:${externalId}:provider_updated:${revision.toISOString()}`,JSON.stringify({providerStatus})]);}
 const observation=['poll_observed','report_observed'].includes(topic);
 const eventTypes=observation?['observed',...(cancelled?['cancelled']:[])]:[cancelled?'cancelled':'received'];
 let firstOrderEvent=false;
 for(const eventType of eventTypes){
  const eventKey=`${platform}:${accountId}:${externalId}:${eventType}`;
  const inserted=await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(tenant_id,event_key) DO NOTHING RETURNING id`,[tenantId,orderId,eventKey,eventType,JSON.stringify({providerStatus,source:topic==='poll_observed'?'seller_poll':topic==='report_observed'?'supplier_report':'seller_event'})]);
  if(inserted.rowCount&&['received','observed'].includes(eventType))firstOrderEvent=true;
 }
 if(firstOrderEvent&&!cancelled&&notify&&freshForAlert){
  await db.query(`INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type)
   SELECT $1,$2,id,'new_order' FROM ci_alert_recipient
   WHERE tenant_id=$1 AND active=true AND muted=false AND consented_at IS NOT NULL AND verified_at IS NOT NULL AND ('new_order'=ANY(event_types) OR 'order_observed'=ANY(event_types))
   AND (cardinality(platforms)=0 OR $3=ANY(platforms))
   ON CONFLICT DO NOTHING`,[tenantId,orderId,platform]);
  if(packingAlerts)await db.query(`INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type)
   SELECT $1,$2,id,'packing_ready' FROM ci_alert_recipient
   WHERE tenant_id=$1 AND active=true AND muted=false AND consented_at IS NOT NULL AND verified_at IS NOT NULL AND 'packing_ready'=ANY(event_types)
   AND (cardinality(platforms)=0 OR $3=ANY(platforms))
   ON CONFLICT DO NOTHING`,[tenantId,orderId,platform]);
 }
 return orderId;
}

export async function recordReturn(db,{tenantId,accountId,platform,event}){
 const externalId=clean(event?.id,120),orderId=clean(event?.order_id,120);
 if(!externalId)return null;
 const {rows}=await db.query(`INSERT INTO ci_return_case(tenant_id,account_id,platform,external_return_id,external_order_id,provider_status,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,account_id,external_return_id) DO UPDATE SET provider_status=EXCLUDED.provider_status RETURNING id`,
 [tenantId,accountId,platform,externalId,orderId,clean(event?.status||'reported',60),clean(event?.reason,250)]);
 return rows[0].id;
}

export async function markOrderIntake(db,{tenantId,accountId,externalOrderId,error}){
 const result=await db.query('SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenantId,accountId,externalOrderId]);
 if(!result.rowCount)return;
 const orderId=result.rows[0].id,type=error?'intake_error':'stock_reserved';
  await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(tenant_id,event_key) DO NOTHING`,[tenantId,orderId,`${accountId}:${externalOrderId}:${type}`,type,JSON.stringify(error?{message:String(error).slice(0,300)}:{})]);
}

export const unifiedOrdersApi=(()=>{
 const router=express.Router();
 router.get('/ready',async(req,res)=>{try{await inventoryPool().query('SELECT 1');res.json({ready:true,confirmedAt:new Date().toISOString()});}catch{res.status(503).json({ready:false,error:'Inventory database unavailable'});}});
 router.get('/orders/search',async(req,res)=>{try{
  const page=Math.max(1,Math.min(100000,Number.parseInt(String(req.query.page||'1'),10)||1));
  const limit=Math.max(1,Math.min(100,Number.parseInt(String(req.query.limit||'25'),10)||25));
  const search=String(req.query.q||'').trim().slice(0,120),platform=String(req.query.platform||'').trim().slice(0,50),status=String(req.query.status||'').trim().slice(0,60);
  const program=String(req.query.program||'').slice(0,60);
  const params=[req.inventoryTenantId,`%${search.replace(/[\\%_]/g,'\\$&')}%`,platform,status,program,limit,(page-1)*limit];
  const where=`o.tenant_id=$1 AND ($5='' OR EXISTS(SELECT 1 FROM ci_program_order p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id AND p.program_key=$5)) AND ($3='' OR o.platform=$3) AND ($4='' OR o.work_status=$4) AND ($2='%%' OR o.external_order_id ILIKE $2 ESCAPE '\\' OR EXISTS(SELECT 1 FROM ci_unified_order_line l WHERE l.tenant_id=o.tenant_id AND l.order_id=o.id AND (l.seller_sku ILIKE $2 ESCAPE '\\' OR l.title ILIKE $2 ESCAPE '\\')))`;
  const [count,rows,accounts]=await Promise.all([
   inventoryPool().query(`SELECT count(*)::integer AS total FROM ci_unified_order o WHERE ${where}`,params.slice(0,5)),
   inventoryPool().query(`SELECT o.*,(SELECT program_key FROM ci_program_order p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id) AS sales_program,a.external_account_id,a.status AS account_status,a.connection_state,coalesce((SELECT jsonb_agg(jsonb_build_object('sku',seller_sku,'quantity',quantity,'title',title) ORDER BY external_line_id) FROM ci_unified_order_line WHERE tenant_id=o.tenant_id AND order_id=o.id),'[]'::jsonb) AS items FROM ci_unified_order o JOIN ci_channel_account a ON a.tenant_id=o.tenant_id AND a.id=o.account_id WHERE ${where} ORDER BY o.first_seen_at DESC,o.id DESC LIMIT $6 OFFSET $7`,params),
   inventoryPool().query(`SELECT a.*,
    coalesce((SELECT count(*)::integer FROM ci_channel_mapping m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.active),0) AS active_mappings,
    coalesce((SELECT h.last_seen_at>now()-interval '2 minutes' FROM ci_service_heartbeat h WHERE h.tenant_id=a.tenant_id AND h.service='inventory-worker'),false) AS worker_healthy,
    (SELECT c.last_success_at FROM ci_sync_cursor c WHERE c.tenant_id=a.tenant_id AND c.account_id=a.id AND c.stream='shopify_order_observation') AS order_cursor_at,
    (SELECT max(i.received_at) FROM ci_ingress i WHERE i.tenant_id=a.tenant_id AND i.source=CASE WHEN a.platform='shopify' THEN 'shopify:'||a.id::text WHEN a.platform='woocommerce' THEN 'woocommerce:'||a.id::text ELSE a.platform||':'||a.id::text END) AS last_webhook_at,
    (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='shopify_readback' AND s.status='success') AS last_inventory_read_at,
    (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='publish_stock' AND s.status='success') AS last_inventory_write_at,
    (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='scheduled_provider_observation' AND s.status='success') AS last_observation_at
    FROM ci_channel_account a WHERE a.tenant_id=$1 ORDER BY a.platform,a.external_account_id`,[req.inventoryTenantId])
  ]);
  const accountViews=accounts.rows.map(account=>{
   const readiness=connectionReadiness(account,{activeMappings:account.active_mappings,workerHealthy:account.worker_healthy,orderCursorAt:account.order_cursor_at,lastWebhookAt:account.last_webhook_at,lastInventoryReadAt:account.last_inventory_read_at,lastInventoryWriteAt:account.last_inventory_write_at,lastObservationAt:account.last_observation_at});
   return {platform:account.platform,external_account_id:account.external_account_id,status:account.status,connection_state:account.connection_state,live_connected:readiness.orders.state==='live',readiness};
  });
  res.json({rows:rows.rows,total:count.rows[0].total,page,limit,accounts:accountViews,confirmedAt:new Date().toISOString()});
 }catch{res.status(503).json({error:'Live order database unavailable'});}});
 router.get('/orders',async(req,res)=>{try{
  const {rows}=await inventoryPool().query(`SELECT o.*,(SELECT program_key FROM ci_program_order p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id) AS sales_program,coalesce((SELECT jsonb_agg(jsonb_build_object('sku',seller_sku,'quantity',quantity,'title',title) ORDER BY external_line_id) FROM ci_unified_order_line WHERE tenant_id=o.tenant_id AND order_id=o.id),'[]'::jsonb) AS items,
   CASE WHEN o.work_status='cancelled' THEN 'cancelled' ELSE (SELECT event_type FROM ci_order_timeline WHERE tenant_id=o.tenant_id AND order_id=o.id ORDER BY id DESC LIMIT 1) END AS last_event,
   (SELECT count(*) FROM ci_order_alert WHERE tenant_id=o.tenant_id AND order_id=o.id AND status='pending')::integer AS pending_alerts
   FROM ci_unified_order o WHERE o.tenant_id=$1 ORDER BY first_seen_at DESC,id DESC LIMIT 500`,[req.inventoryTenantId]);res.json(rows);
 }catch{res.status(503).json({error:'Unified order database unavailable'});}});
 router.get('/activity',async(req,res)=>{try{
  const {rows}=await inventoryPool().query(`SELECT t.id,t.event_type,t.detail,t.occurred_at,o.platform,o.external_order_id,o.work_status,(SELECT program_key FROM ci_program_order p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id) AS sales_program
   FROM ci_order_timeline t JOIN ci_unified_order o ON o.tenant_id=t.tenant_id AND o.id=t.order_id
   WHERE t.tenant_id=$1 ORDER BY t.occurred_at DESC,t.id DESC LIMIT 100`,[req.inventoryTenantId]);res.json(rows);
 }catch{res.status(503).json({error:'Order activity unavailable'});}});
 router.get('/events',async(req,res)=>{
  let client,timer,closed=false;
  const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);client?.release();};
  try{
   client=await inventoryPool().connect();await client.query('LISTEN ci_inventory_changes');
   client.on('error',()=>{if(closed)return;closed=true;clearInterval(timer);client.release(true);res.end();});
   res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();res.write(`event: ready\ndata: ${JSON.stringify({at:new Date().toISOString()})}\n\n`);
   client.on('notification',message=>{if(message.channel==='ci_inventory_changes'&&message.payload===req.inventoryTenantId&&!closed)res.write(`event: changed\ndata: ${JSON.stringify({at:new Date().toISOString()})}\n\n`);});
   // A GET request's IncomingMessage can emit `close` as soon as its request
   // body completes. Keep the listener attached to the response lifetime.
   timer=setInterval(()=>{if(!closed)res.write(': keepalive\n\n');},20000);res.on('close',cleanup);
  }catch{cleanup();if(!res.headersSent)res.status(503).json({error:'Live inventory updates unavailable'});else res.end();}
 });
 router.get('/orders/:id/timeline',async(req,res)=>{try{const {rows}=await inventoryPool().query(`SELECT event_type,detail,occurred_at FROM ci_order_timeline WHERE tenant_id=$1 AND order_id=$2 ORDER BY id`,[req.inventoryTenantId,req.params.id]);res.json(rows);}catch{res.status(400).json({error:'Invalid order ID'});}});
 router.post('/orders/:id/status',async(req,res)=>{try{
  const next=String(req.body.status||'');if(!['accepted','packed','dispatched'].includes(next))return res.status(400).json({error:'Unsupported staff status'});
  const row=(await inventoryPool().query('SELECT platform FROM ci_unified_order WHERE tenant_id=$1 AND id=$2',[req.inventoryTenantId,req.params.id])).rows[0];
  if(!row)return res.status(404).json({error:'Order not found'});
  if(row.platform!=='offline')return res.status(409).json({error:'Seller order actions require a provider-authorized fulfillment connector and readback'});
  return res.status(501).json({error:'Offline fulfillment requires verified order intake, physical pick/pack evidence, and dispatch handover before staff status changes can be recorded'});
 }catch(error){res.status(error.status||400).json({error:error.message});}});
 router.get('/team',async(req,res)=>{try{const {rows}=await inventoryPool().query('SELECT id,name,role,mobile_e164,platforms,event_types,active,muted,consented_at,verified_at,alert_start,alert_end FROM ci_alert_recipient WHERE tenant_id=$1 ORDER BY name',[req.inventoryTenantId]);res.json(rows);}catch{res.status(503).json({error:'Team unavailable'});}});
 router.get('/team/verification-setup',(_req,res)=>res.json({configured:otpConfigured(),templateConfigured:Boolean(process.env.WHATSAPP_OTP_TEMPLATE)}));
 router.post('/team/:id/verification/send',async(req,res)=>{try{res.json(await requestRecipientOtp({tenantId:req.inventoryTenantId,recipientId:req.params.id,pool:inventoryPool()}));}catch(error){res.status(error.status||503).json({error:error.message||'Could not send verification code'});}});
 router.post('/team/:id/verification/confirm',async(req,res)=>{try{res.json(await verifyRecipientOtp({tenantId:req.inventoryTenantId,recipientId:req.params.id,code:String(req.body.code||'')}));}catch(error){res.status(error.status||503).json({error:error.message||'Could not verify number'});}});
 router.get('/whatsapp/setup',(_req,res)=>res.json(whatsappSetup()));
 router.post('/whatsapp/verify-sender',async(_req,res)=>{
  const setup=whatsappSetup();
  if(!setup.senderConfigured)return res.status(409).json({error:'Configure the missing Meta Cloud API settings before verifying the sender',missing:setup.missing});
  const version=process.env.WHATSAPP_GRAPH_VERSION,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!/^v\d+\.\d+$/.test(version)||!/^\d+$/.test(phoneId))return res.status(400).json({error:'Meta API version or phone number ID has an invalid format'});
  try{
   const response=await providerFetch(`https://graph.facebook.com/${version}/${phoneId}?fields=id,verified_name,display_phone_number`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`}});
   if(!response.ok)return res.status(502).json({error:`Meta did not verify this sender (HTTP ${response.status})`});
   const body=await response.json();
   if(String(body.id)!==phoneId)return res.status(502).json({error:'Meta returned a different WhatsApp phone number ID'});
   res.json({verified:true,verifiedName:body.verified_name||null,phoneIdSuffix:phoneId.slice(-4)});
  }catch{res.status(503).json({error:'Meta sender verification could not complete'});}
 });
 router.get('/returns',async(req,res)=>{try{const {rows}=await inventoryPool().query(`SELECT r.*,(SELECT p.program_key FROM ci_unified_order o JOIN ci_program_order p ON p.tenant_id=o.tenant_id AND p.order_id=o.id WHERE o.tenant_id=r.tenant_id AND o.account_id=r.account_id AND o.external_order_id=r.external_order_id) AS sales_program FROM ci_return_case r WHERE r.tenant_id=$1 ORDER BY r.first_seen_at DESC LIMIT 500`,[req.inventoryTenantId]);res.json(rows);}catch{res.status(503).json({error:'Returns unavailable'});}});
 router.get('/returns/:id/options',async(req,res)=>{try{res.json(await returnOptions(req.inventoryTenantId,req.params.id));}catch(error){res.status(error.status||400).json({error:error.message});}});
 router.post('/returns/:id/approve-receipt',async(req,res)=>{try{res.json(await approveReturnReceipt({tenantId:req.inventoryTenantId,returnId:req.params.id,requestId:req.body.requestId,masterSkuId:req.body.masterSkuId,locationId:req.body.locationId,quantity:req.body.quantity}));}catch(error){res.status(error.status||400).json({error:error.message});}});
 router.post('/team',async(req,res)=>{try{
  const {name,role,mobile,platforms=[],eventTypes=['new_order'],consent,alertStart=null,alertEnd=null}=req.body;
  if(typeof name!=='string'||!name.trim()||name.length>120||!['packer','dispatcher','manager','returns'].includes(role)||typeof mobile!=='string'||!/^\+[1-9]\d{7,14}$/.test(mobile)||!Array.isArray(platforms)||platforms.some(p=>typeof p!=='string'||!connectionCatalog.some(config=>config.key===p))||!Array.isArray(eventTypes)||!eventTypes.length||eventTypes.some(type=>!['new_order','packing_ready','order_observed'].includes(type)))return res.status(400).json({error:'Enter a name, role, E.164 mobile number, alert event and platform keys shown in Channel connections'});
  if(Boolean(alertStart)!==Boolean(alertEnd)||(alertStart&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(alertStart)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(alertEnd)||alertStart===alertEnd)))return res.status(400).json({error:'Enter both different start/end times in Asia/Kolkata, or leave both blank'});
  const {rows}=await inventoryPool().query(`INSERT INTO ci_alert_recipient(tenant_id,name,role,mobile_e164,platforms,event_types,active,consented_at,alert_start,alert_end) VALUES($1,$2,$3,$4,$5,$6,false,CASE WHEN $7 THEN now() ELSE NULL END,$8,$9)
   ON CONFLICT(tenant_id,mobile_e164) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,platforms=EXCLUDED.platforms,event_types=EXCLUDED.event_types,active=CASE WHEN NOT $7 THEN false WHEN ci_alert_recipient.consented_at IS NULL AND ci_alert_recipient.verified_at IS NOT NULL THEN true ELSE ci_alert_recipient.active END,consented_at=CASE WHEN $7 THEN coalesce(ci_alert_recipient.consented_at,now()) ELSE NULL END,alert_start=EXCLUDED.alert_start,alert_end=EXCLUDED.alert_end RETURNING id,name,role,mobile_e164,platforms,event_types,active,muted,consented_at,verified_at,alert_start,alert_end`,[req.inventoryTenantId,name.trim(),role,mobile,platforms,eventTypes,consent===true,alertStart,alertEnd]);res.json(rows[0]);
 }catch{res.status(503).json({error:'Could not save team member'});}});
 router.post('/team/:id/state',async(req,res)=>{try{
  if(typeof req.body.active!=='boolean'||typeof req.body.muted!=='boolean')return res.status(400).json({error:'Active and muted must be boolean'});
  const result=await transaction(async db=>{const current=(await db.query('SELECT verified_at,consented_at FROM ci_alert_recipient WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.inventoryTenantId,req.params.id])).rows[0];if(!current)return null;if(req.body.active&&(!current.verified_at||!current.consented_at))throw Object.assign(new Error('Verify the number and record alert consent before activating this recipient'),{status:409});return (await db.query('UPDATE ci_alert_recipient SET active=$3,muted=$4 WHERE tenant_id=$1 AND id=$2 RETURNING id,name,role,mobile_e164,platforms,event_types,active,muted,consented_at,verified_at',[req.inventoryTenantId,req.params.id,req.body.active,req.body.muted])).rows[0];});if(!result)return res.sendStatus(404);res.json(result);
 }catch(error){res.status(error.status||400).json({error:error.message||'Invalid team member'});}});
 router.get('/health',async(req,res)=>{try{
  const [accounts,alerts,errors,unassigned,stuck,heartbeat,blockedAlerts]=await Promise.all([
   inventoryPool().query("SELECT a.platform,a.external_account_id,a.status,a.connection_state,a.verified_at,a.settings,coalesce((a.settings->>'orderObservationEnabled')::boolean,false) AS order_monitoring,coalesce((a.settings->>'webhooksReady')::boolean,false) AS webhooks_ready,greatest((a.settings->>'lastSyncAt')::timestamptz,(a.settings->>'lastOrderObservationAt')::timestamptz) AS last_sync_at,c.last_success_at AS order_cursor_at,c.failure_count AS order_poll_failures,(SELECT max(i.received_at) FROM ci_ingress i WHERE i.tenant_id=a.tenant_id AND i.source=CASE WHEN a.platform='shopify' THEN 'shopify:'||a.id::text WHEN a.platform='woocommerce' THEN 'woocommerce:'||a.id::text ELSE a.platform||':'||a.id::text END) AS last_webhook_at,coalesce((SELECT h.last_seen_at>now()-interval '2 minutes' FROM ci_service_heartbeat h WHERE h.tenant_id=a.tenant_id AND h.service='inventory-worker'),false) AS worker_healthy,coalesce((SELECT count(*)::integer FROM ci_channel_mapping m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.active),0) AS active_mappings,(SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='shopify_readback' AND s.status='success') AS last_inventory_read_at,(SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='publish_stock' AND s.status='success') AS last_inventory_write_at,(SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='scheduled_provider_observation' AND s.status='success') AS last_observation_at FROM ci_channel_account a LEFT JOIN ci_sync_cursor c ON c.tenant_id=a.tenant_id AND c.account_id=a.id AND c.stream='shopify_order_observation' WHERE a.tenant_id=$1 ORDER BY a.platform",[req.inventoryTenantId]),
   inventoryPool().query("SELECT status,count(*)::integer AS count FROM ci_order_alert WHERE tenant_id=$1 GROUP BY status",[req.inventoryTenantId]),
   inventoryPool().query("SELECT count(*)::integer AS count FROM ci_outbox WHERE tenant_id=$1 AND status='dead'",[req.inventoryTenantId]),
   inventoryPool().query("SELECT count(*)::integer AS count FROM ci_unified_order o WHERE o.tenant_id=$1 AND o.work_status='new' AND NOT EXISTS(SELECT 1 FROM ci_order_alert a WHERE a.tenant_id=o.tenant_id AND a.order_id=o.id)",[req.inventoryTenantId]),
   inventoryPool().query("SELECT count(*)::integer AS count FROM ci_unified_order o WHERE o.tenant_id=$1 AND o.work_status='new' AND o.first_seen_at<now()-interval '20 minutes'",[req.inventoryTenantId]),
   inventoryPool().query("SELECT service,last_seen_at,last_seen_at>now()-interval '2 minutes' AS healthy FROM ci_service_heartbeat WHERE tenant_id=$1",[req.inventoryTenantId]),
   inventoryPool().query("SELECT count(*)::integer AS count FROM ci_order_alert a WHERE a.tenant_id=$1 AND a.event_type='packing_ready' AND a.status='pending' AND a.available_at<now()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM ci_order_timeline t WHERE t.tenant_id=a.tenant_id AND t.order_id=a.order_id AND t.event_type='stock_reserved')",[req.inventoryTenantId])
  ]);
  const accountViews=accounts.rows.map(account=>{
   const readiness=connectionReadiness(account,{activeMappings:account.active_mappings,workerHealthy:account.worker_healthy,orderCursorAt:account.order_cursor_at,lastWebhookAt:account.last_webhook_at,lastInventoryReadAt:account.last_inventory_read_at,lastInventoryWriteAt:account.last_inventory_write_at,lastObservationAt:account.last_observation_at});
   return {...account,readiness};
  });
  res.json({accounts:accountViews,alerts:alerts.rows,deadTasks:errors.rows[0].count,unassignedOrders:unassigned.rows[0].count,ordersWaitingOver20Minutes:stuck.rows[0].count,blockedPackingAlerts:blockedAlerts.rows[0].count,services:heartbeat.rows,whatsappConfigured:whatsappReady(),whatsapp:whatsappSetup()});
 }catch{res.status(503).json({error:'Health data unavailable'});}});
 return router;
})();
