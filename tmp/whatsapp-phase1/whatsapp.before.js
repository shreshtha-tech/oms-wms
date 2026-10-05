import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { providerFetch, httpsOrigin } from './connection-security.js';

const senderKeys=['WHATSAPP_GRAPH_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN'];
const configured=()=>senderKeys.every(key=>Boolean(process.env[key]))&&/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION||'')&&/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID||'');
export function whatsappSetup(){
 const missing=senderKeys.filter(key=>!process.env[key]);
 if(process.env.WHATSAPP_GRAPH_VERSION&&!/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION))missing.push('Valid WHATSAPP_GRAPH_VERSION');
 if(process.env.WHATSAPP_PHONE_NUMBER_ID&&!/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID))missing.push('Valid WHATSAPP_PHONE_NUMBER_ID');
 let origin=null;try{origin=httpsOrigin(process.env.INVENTORY_PUBLIC_ORIGIN||'');}catch{}
 return {senderConfigured:configured(),newOrderTemplateConfigured:Boolean(process.env.WHATSAPP_ORDER_TEMPLATE),packingTemplateConfigured:Boolean(process.env.WHATSAPP_PACKING_TEMPLATE),missing,callbackUrl:origin?`${origin}/api/inventory-sync/whatsapp/webhook`:null};
}
export function whatsappReady(){return configured()&&Boolean(process.env.WHATSAPP_ORDER_TEMPLATE||process.env.WHATSAPP_OBSERVED_ORDER_TEMPLATE||process.env.WHATSAPP_PACKING_TEMPLATE);}

export function whatsappTemplatePayload(row,items,settings=process.env){
 const fourth=row.event_type==='packing_ready'?(row.dispatch_by?new Date(row.dispatch_by).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'See order panel'):'Check stock in D-Mills';
 const params=[row.platform,row.external_order_id,items.map(i=>`${i.seller_sku} × ${i.quantity}`).join(', ').slice(0,500)||'See order panel',fourth];
 const template=row.event_type==='packing_ready'?settings.WHATSAPP_PACKING_TEMPLATE:row.event_type==='order_observed'?(settings.WHATSAPP_OBSERVED_ORDER_TEMPLATE||settings.WHATSAPP_ORDER_TEMPLATE):settings.WHATSAPP_ORDER_TEMPLATE;
 if(!template)throw new Error('Approved WhatsApp template is not configured for this order update');
 return {messaging_product:'whatsapp',recipient_type:'individual',to:row.mobile_e164.slice(1),type:'template',template:{name:template,language:{code:settings.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},components:[{type:'body',parameters:params.map(text=>({type:'text',text}))}]}};
}

export async function runWhatsAppBatch(limit=10,fetcher=providerFetch){
 const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
 if(!tenantId)throw new Error('INVENTORY_ALLOWED_TENANT_ID is required before processing WhatsApp alerts');
 const pool=inventoryPool();
 await pool.query("UPDATE ci_order_alert SET status='failed',last_error=COALESCE(last_error,'Notification attempt limit exhausted; operator review required'),claimed_at=NULL WHERE tenant_id=$1 AND status='pending' AND attempt_count>=8",[tenantId]);
 const stale=await pool.query("UPDATE ci_order_alert SET status='uncertain',last_error='Worker stopped during send; delivery must be checked before retry' WHERE tenant_id=$1 AND status='sending' AND claimed_at<now()-interval '2 minutes' RETURNING id",[tenantId]);
 await pool.query("UPDATE ci_order_alert a SET status='failed',last_error='New-order alert expired before WhatsApp delivery' FROM ci_unified_order o WHERE a.tenant_id=$1 AND a.tenant_id=o.tenant_id AND a.order_id=o.id AND a.event_type='new_order' AND a.status='pending' AND o.first_seen_at<now()-interval '2 hours'",[tenantId]);
 if(!whatsappReady())return {claimed:0,uncertain:stale.rowCount,configured:false};
 const claims=await transaction(async db=>(await db.query(`UPDATE ci_order_alert a SET status='sending',claimed_at=now(),attempt_count=attempt_count+1
  FROM ci_alert_recipient r,ci_unified_order o WHERE a.tenant_id=$5 AND r.tenant_id=a.tenant_id AND o.tenant_id=a.tenant_id AND a.recipient_id=r.id AND a.order_id=o.id AND r.verified_at IS NOT NULL AND o.work_status NOT IN ('cancelled','returned')
  AND (a.event_type<>'packing_ready' OR o.work_status NOT IN ('packed','dispatched'))
  AND a.id IN (SELECT q.id FROM ci_order_alert q JOIN ci_alert_recipient x ON x.tenant_id=q.tenant_id AND x.id=q.recipient_id
    WHERE q.tenant_id=$5 AND q.status='pending' AND q.attempt_count<8 AND q.available_at<=now() AND x.active AND NOT x.muted AND x.consented_at IS NOT NULL AND x.verified_at IS NOT NULL
    AND ((q.event_type='new_order' AND $2) OR (q.event_type='order_observed' AND $3) OR (q.event_type='packing_ready' AND $4))
    AND (x.alert_start IS NULL OR (x.alert_start<x.alert_end AND (now() AT TIME ZONE 'Asia/Kolkata')::time>=x.alert_start AND (now() AT TIME ZONE 'Asia/Kolkata')::time<x.alert_end)
      OR (x.alert_start>x.alert_end AND ((now() AT TIME ZONE 'Asia/Kolkata')::time>=x.alert_start OR (now() AT TIME ZONE 'Asia/Kolkata')::time<x.alert_end)))
    AND (q.event_type<>'packing_ready' OR EXISTS(SELECT 1 FROM ci_order_timeline t WHERE t.tenant_id=q.tenant_id AND t.order_id=q.order_id AND t.event_type='stock_reserved'))
    ORDER BY q.available_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT $1)
  RETURNING a.id,a.tenant_id,a.order_id,a.event_type,a.attempt_count,r.mobile_e164,o.platform,o.external_order_id,o.provider_status,o.dispatch_by`,[limit,Boolean(process.env.WHATSAPP_ORDER_TEMPLATE),Boolean(process.env.WHATSAPP_OBSERVED_ORDER_TEMPLATE||process.env.WHATSAPP_ORDER_TEMPLATE),Boolean(process.env.WHATSAPP_PACKING_TEMPLATE),tenantId])).rows);
 for(const row of claims){
  let sendStarted=false;
  try{
   const items=(await pool.query('SELECT seller_sku,quantity FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=$2 ORDER BY external_line_id LIMIT 10',[row.tenant_id,row.order_id])).rows;
   const body=whatsappTemplatePayload(row,items);
   const version=process.env.WHATSAPP_GRAPH_VERSION,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
   if(!/^v\d+\.\d+$/.test(version)||!/^\d+$/.test(phoneId))throw new Error('WhatsApp API version or phone number ID is invalid');
   const requestBody=JSON.stringify(body);
   sendStarted=true;
   const response=await fetcher(`https://graph.facebook.com/${version}/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:requestBody});
   if(!response.ok){const retry=response.status===429||response.status>=500;await pool.query(`UPDATE ci_order_alert SET status=$2,available_at=now()+($3||' seconds')::interval,last_error=$4,claimed_at=NULL WHERE id=$1 AND status='sending'`,[row.id,retry&&row.attempt_count<8?'pending':'failed',String(Math.min(3600,30*2**Math.min(row.attempt_count,7))),`Meta rejected message (HTTP ${response.status})`]);continue;}
   const payload=await response.json().catch(()=>null),messageId=payload?.messages?.[0]?.id;
   if(typeof messageId!=='string'||!messageId.startsWith('wamid.'))throw new Error('Meta response lacked a message ID');
   await pool.query("UPDATE ci_order_alert SET status='accepted',provider_message_id=$2,accepted_at=now(),claimed_at=NULL,last_error=NULL WHERE id=$1 AND status='sending'",[row.id,messageId]);
   await pool.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'whatsapp_accepted',$4) ON CONFLICT DO NOTHING`,[row.tenant_id,row.order_id,`whatsapp:${row.id}:accepted`,JSON.stringify({recipientId:row.id})]);
  }catch{
   if(sendStarted){
    await pool.query("UPDATE ci_order_alert SET status='uncertain',last_error='WhatsApp send outcome unknown; review Meta before retry',claimed_at=NULL WHERE id=$1 AND status='sending'",[row.id]);
   }else{
    await pool.query("UPDATE ci_order_alert SET status=$2,available_at=now()+($3||' seconds')::interval,last_error='WhatsApp preparation failed before send',claimed_at=NULL WHERE id=$1 AND status='sending'",[row.id,row.attempt_count<8?'pending':'failed',String(Math.min(3600,30*2**Math.min(row.attempt_count,7)))]);
   }
  }
 }
 return {claimed:claims.length,uncertain:stale.rowCount,configured:true};
}

export const whatsappPublic=express.Router();
whatsappPublic.get('/webhook',(req,res)=>{
 const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],challenge=req.query['hub.challenge'];
 if(mode==='subscribe'&&process.env.WHATSAPP_VERIFY_TOKEN&&token===process.env.WHATSAPP_VERIFY_TOKEN&&typeof challenge==='string')return res.type('text/plain').send(challenge);
 res.sendStatus(403);
});
whatsappPublic.post('/webhook',express.raw({type:()=>true,limit:'1mb'}),async(req,res)=>{
 try{
  const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
  if(!tenantId)return res.sendStatus(503);
  const signature=String(req.get('x-hub-signature-256')||''),secret=process.env.WHATSAPP_APP_SECRET;
  if(!secret||!/^sha256=[a-f0-9]{64}$/i.test(signature))return res.sendStatus(401);
  const expected=createHmac('sha256',secret).update(req.body).digest('hex');
  if(!timingSafeEqual(Buffer.from(signature.slice(7),'hex'),Buffer.from(expected,'hex')))return res.sendStatus(401);
  const payload=JSON.parse(req.body);
  if(payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return res.sendStatus(400);
  for(const entry of payload.entry)for(const change of entry.changes||[]){
   const value=change.value;if(change.field!=='messages'||value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)continue;
   for(const status of value.statuses||[]){
    if(typeof status.id!=='string'||!['sent','delivered','read','failed'].includes(status.status))continue;
    await transaction(async db=>{
    const rank={accepted:0,sent:1,delivered:2,read:3,failed:4};
    const row=(await db.query('SELECT id,tenant_id,order_id,status FROM ci_order_alert WHERE tenant_id=$2 AND provider_message_id=$1 FOR UPDATE',[status.id,tenantId])).rows[0];
    if(!row||row.status===status.status||row.status==='read'||(row.status==='delivered'&&status.status==='sent')||row.status==='failed')return;
    if(status.status!=='failed'&&rank[status.status]<rank[row.status])return;
    await db.query('UPDATE ci_order_alert SET status=$2,delivered_at=CASE WHEN $2 IN (\'delivered\',\'read\') THEN now() ELSE delivered_at END,last_error=CASE WHEN $2=\'failed\' THEN \'Meta reported delivery failure\' ELSE NULL END WHERE id=$1',[row.id,status.status]);
    await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,$4,'{}') ON CONFLICT DO NOTHING`,[row.tenant_id,row.order_id,`whatsapp:${row.id}:${status.status}`,`whatsapp_${status.status}`]);
    });
   }
  }
  res.sendStatus(200);
 }catch{res.sendStatus(400);}
});
