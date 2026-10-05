import express from 'express';
import { orderAlertPolicy } from './order-alert-policy.js';
import { connectionCatalog } from './connection-catalog.js';
import { salesPrograms } from './sales-programs.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { httpsOrigin, publicAddress } from './connection-security.js';

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
 const fourth=row.team_kind==='informational'?(row.team_instruction||'Review observed order'):row.event_type==='packing_ready'||row.team_kind==='packing'?(row.dispatch_by?new Date(row.dispatch_by).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'See order panel'):'Check stock in D-Mills';
 const programmeName=salesPrograms.find(p=>p.key===row.sales_program)?.name;
 const platformName=row.sales_program?`${connectionCatalog.find(c=>c.key===row.platform)?.name||row.platform} · ${programmeName||row.sales_program}`:row.platform;
 const params=[platformName,row.external_order_id,items.map(i=>`${i.seller_sku} × ${i.quantity}`).join(', ')||'See order panel',fourth].map(value=>String(value??'See order panel').replace(/[\r\n\t]/g,' ').replace(/ {4,}/g,' ').slice(0,500));
 const template=row.event_type==='packing_ready'?settings.WHATSAPP_PACKING_TEMPLATE:row.event_type==='order_observed'?(settings.WHATSAPP_OBSERVED_ORDER_TEMPLATE||settings.WHATSAPP_ORDER_TEMPLATE):settings.WHATSAPP_ORDER_TEMPLATE;
 if(!/^[a-z0-9_]{1,512}$/.test(template||''))throw new Error('Approved WhatsApp template is not configured or has an invalid name');
 if(!/^\+[1-9]\d{7,14}$/.test(row.mobile_e164||''))throw new Error('Recipient phone format is invalid');
 if(!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(settings.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'))throw new Error('WhatsApp template language is invalid');
 return {messaging_product:'whatsapp',recipient_type:'individual',to:row.mobile_e164.slice(1),type:'template',template:{name:template,language:{code:settings.WHATSAPP_TEMPLATE_LANGUAGE||'en_US'},components:[{type:'body',parameters:params.map(text=>({type:'text',text}))}]}};
}

// Fixed Meta origin only; signal dispatch when Node finishes writing the request.
// Injected transports use the same onDispatch callback before simulating a sent request.
export async function whatsappFetch(input,{onDispatch=()=>{},...options}={}){
 const url=new URL(input);
 if(url.origin!=='https://graph.facebook.com'||url.username||url.password)throw new Error('Invalid Meta origin');
 let timer;const answers=await Promise.race([lookup(url.hostname,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Meta DNS lookup timed out')),20000);})]).finally(()=>clearTimeout(timer));
 if(!answers.length||answers.some(answer=>!publicAddress(answer.address)))throw new Error('Meta hostname did not resolve to a public address');
 const chosen=answers[0];
 return new Promise((resolve,reject)=>{
  const request=https.request(url,{...options,lookup:(_host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>4_000_000){request.destroy(new Error('Meta response exceeds 4 MB'));return;}chunks.push(chunk);});
   response.on('end',()=>resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));
   response.on('error',reject);
  });
  request.once('finish',onDispatch);
  request.setTimeout(20000,()=>request.destroy(new Error('Meta request timed out')));
  request.on('error',reject);
  request.end(options.body);
 });
}

// PostgreSQL session lock serializes ALL sender processes (web OTP and worker).
// Hold it for at least one second per attempt, without holding a DB transaction.
export async function withWhatsAppRateLimit(tenantId,operation,{maxWaitMs=30000}={}){
 if(!tenantId)throw new Error('Inventory tenant is required for WhatsApp sending');
 const key=`whatsapp-send:${tenantId}`;let client,started;const deadline=Date.now()+maxWaitMs;
 // Waiting callers release their pool connection, leaving capacity for the
 // winning sender's transaction even during a burst of web OTP requests.
 while(true){
  if(Date.now()>=deadline)throw Object.assign(new Error('WhatsApp sender is busy; retry later'),{status:429});
  client=await inventoryPool().connect();let acquired=false;
  try{acquired=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[key])).rows[0].acquired;}
  catch(error){client.release(true);throw error;}
  if(acquired)break;client.release();await new Promise(resolve=>setTimeout(resolve,100));
 }
 started=Date.now();
 try{return await operation();}
 finally{
  let discard=false;
  try{await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(Date.now()-started))));await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
  catch(error){discard=true;throw error;}
  finally{client.release(discard);}
 }
}

const permanentMetaCodes=new Set([10,190,200,131005,131008,131009,131021,131026,131030,131031,131042,131047,132000,132001,132005,132007,132012,132015,132016,133010]);
const transientMetaCodes=new Set([1,2,4,17,32,613,80007,130429,131000,131016,131048,131056]);
export function metaRetryable(httpStatus,error={}){
 if(permanentMetaCodes.has(Number(error.code))||httpStatus===401||httpStatus===403)return false;
 return httpStatus===429||httpStatus>=500||transientMetaCodes.has(Number(error.code));
}
export function whatsappSafeText(value,settings=process.env){
 let text=typeof value==='string'?value:'Unknown error';
 for(const key of senderKeys){const secret=settings[key];if(secret)text=text.split(secret).join('[redacted]');}
 text=text.replace(/[\r\n\t]/g,' ').replace(/ {4,}/g,' ');
 return text.replace(/(?:Bearer\s+|access_token[=:]\s*)[^\s,;]+/gi,'[redacted]').replace(/\+?\d[\d ().-]{6,}\d/g,phone=>`***${phone.replace(/\D/g,'').slice(-4)}`).replace(/[\r\n\t]/g,' ').replace(/ {4,}/g,' ').slice(0,300);
}
export function metaErrorText(error={},httpStatus){
 const code=Number.isSafeInteger(error.code)?error.code:'unknown',subcode=Number.isSafeInteger(error.error_subcode)?error.error_subcode:'none';
 return `Meta error code=${code} subcode=${subcode}${httpStatus?` HTTP=${httpStatus}`:''}: ${whatsappSafeText(error.message||error.title||'Message rejected')}`;
}
export const whatsappBackoff=attempt=>Math.min(3600,30*2**Math.min(attempt,7)*(1+Math.random()*0.25));

export async function runWhatsAppBatch(limit=10,fetcher=whatsappFetch){
 const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
 if(!tenantId)throw new Error('INVENTORY_ALLOWED_TENANT_ID is required before processing WhatsApp alerts');
 const pool=inventoryPool();
 await pool.query("UPDATE ci_order_alert SET status='failed',last_error=COALESCE(last_error,'Notification attempt limit exhausted; operator review required'),claimed_at=NULL WHERE tenant_id=$1 AND status='pending' AND attempt_count>=8",[tenantId]);
 const stale=await pool.query("UPDATE ci_order_alert SET status='uncertain',last_error='Worker stopped during a send; check delivery before retry',claimed_at=NULL WHERE tenant_id=$1 AND status='sending' AND claimed_at<now()-interval '2 minutes' RETURNING id",[tenantId]);
 await pool.query("UPDATE ci_order_alert a SET status='failed',last_error='New-order alert expired before WhatsApp delivery' FROM ci_unified_order o WHERE a.tenant_id=$1 AND a.tenant_id=o.tenant_id AND a.order_id=o.id AND a.event_type='new_order' AND a.status='pending' AND o.first_seen_at<now()-interval '2 hours'",[tenantId]);
 if(!whatsappReady())return {claimed:0,uncertain:stale.rowCount,configured:false};
 let claimed=0;
 for(let index=0;index<limit;index++){
  const processed=await withWhatsAppRateLimit(tenantId,async()=>{
   let row,requestBody,version,phoneId,dispatched=false,responseKnown=false,acceptedId,knownFailure;
   try{
    let policySkipped=false;
    const prepared=await transaction(async db=>{
     row=(await db.query(`SELECT a.id,a.tenant_id,a.order_id,a.event_type,a.attempt_count,r.mobile_e164,o.platform,o.external_order_id,o.dispatch_by,p.program_key AS sales_program,t.kind AS team_kind,t.instruction AS team_instruction
      FROM ci_order_alert a JOIN ci_alert_recipient r ON r.tenant_id=a.tenant_id AND r.id=a.recipient_id JOIN ci_unified_order o ON o.tenant_id=a.tenant_id AND o.id=a.order_id
      LEFT JOIN ci_program_order p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
      LEFT JOIN ci_alert_team t ON t.tenant_id=a.tenant_id AND t.id=a.team_id
      WHERE a.tenant_id=$1 AND a.status='pending' AND a.attempt_count<8 AND a.available_at<=now()
      AND (a.team_id IS NULL OR (t.active AND EXISTS(SELECT 1 FROM ci_alert_team_member member WHERE member.tenant_id=a.tenant_id AND member.team_id=a.team_id AND member.recipient_id=a.recipient_id))) AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
      AND (a.event_type=ANY(r.event_types) OR (a.event_type='new_order' AND 'order_observed'=ANY(r.event_types))) AND o.work_status NOT IN ('cancelled','returned')
      AND (a.event_type<>'packing_ready' OR (o.work_status NOT IN ('packed','dispatched') AND EXISTS(SELECT 1 FROM ci_order_timeline t WHERE t.tenant_id=a.tenant_id AND t.order_id=a.order_id AND t.event_type='stock_reserved')))
      AND ((a.event_type='new_order' AND $2) OR (a.event_type='order_observed' AND $3) OR (a.event_type='packing_ready' AND $4))
      AND (r.alert_start IS NULL OR (r.alert_start<r.alert_end AND (now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start AND (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)
       OR (r.alert_start>r.alert_end AND ((now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start OR (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)))
      ORDER BY a.available_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`,[tenantId,Boolean(process.env.WHATSAPP_ORDER_TEMPLATE),Boolean(process.env.WHATSAPP_OBSERVED_ORDER_TEMPLATE||process.env.WHATSAPP_ORDER_TEMPLATE),Boolean(process.env.WHATSAPP_PACKING_TEMPLATE)])).rows[0];
     if(!row)return false;
     const policy=await orderAlertPolicy(db,{tenantId,orderId:row.order_id});
     if(!policy.enabled||(row.event_type==='packing_ready'&&!policy.packingAllowed)||(policy.informationalOnly&&row.event_type!=='order_observed')){
      await db.query("UPDATE ci_order_alert SET status='cancelled',last_error='Order alert policy no longer permits this notification' WHERE tenant_id=$1 AND id=$2 AND status='pending'",[tenantId,row.id]);policySkipped=true;return false;
     }
     const items=(await db.query('SELECT seller_sku,quantity FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=$2 ORDER BY external_line_id LIMIT 10',[tenantId,row.order_id])).rows;
     requestBody=JSON.stringify(whatsappTemplatePayload(row,items));
     version=process.env.WHATSAPP_GRAPH_VERSION;phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
     if(!configured())throw new Error('WhatsApp sender configuration is invalid');
     await db.query("UPDATE ci_order_alert SET status='sending',claimed_at=now(),attempt_count=attempt_count+1 WHERE tenant_id=$1 AND id=$2 AND status='pending'",[tenantId,row.id]);
     row.attempt_count++;return true;
    });
    if(!prepared)return policySkipped;
    const response=await fetcher(`https://graph.facebook.com/${version}/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:requestBody,onDispatch:()=>{dispatched=true;}});
    dispatched=true; // A provider response proves the request was dispatched.
    let payload=null;try{payload=await response.json();}catch{}
    responseKnown=!response.ok;
    if(!response.ok){
     const error=payload?.error||{};
     knownFailure={status:metaRetryable(response.status,error)&&row.attempt_count<8?'pending':'failed',message:metaErrorText(error,response.status)};
     await pool.query("UPDATE ci_order_alert SET status=$3,available_at=now()+($4||' seconds')::interval,last_error=$5,claimed_at=NULL WHERE tenant_id=$1 AND id=$2 AND status='sending'",[tenantId,row.id,knownFailure.status,String(whatsappBackoff(row.attempt_count)),knownFailure.message]);
     return true;
    }
    acceptedId=payload?.messages?.[0]?.id;
    if(typeof acceptedId!=='string'||!acceptedId.startsWith('wamid.')){acceptedId=null;throw new Error('Meta response lacked a message ID');}
    await transaction(async db=>{
     const updated=await db.query("UPDATE ci_order_alert SET status='accepted',provider_message_id=$3,accepted_at=now(),claimed_at=NULL,last_error=NULL WHERE tenant_id=$1 AND id=$2 AND status='sending' RETURNING id",[tenantId,row.id,acceptedId]);
     if(updated.rowCount)await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'whatsapp_accepted','{}') ON CONFLICT DO NOTHING`,[tenantId,row.order_id,`whatsapp:${row.id}:accepted`]);
    });
   }catch(error){
    if(!row)throw new Error('WhatsApp queue lookup unavailable');
    // A confirmed rejection/acceptance is not an unknown delivery outcome.
    const status=acceptedId?'accepted':responseKnown?knownFailure.status:dispatched?'uncertain':'failed';
    const message=acceptedId?'Meta accepted message; local audit requires review':responseKnown?knownFailure.message:dispatched?'WhatsApp send outcome unknown; review Meta before retry':`WhatsApp preparation failed before dispatch: ${whatsappSafeText(error instanceof Error?error.message:'Unknown preparation error')}`;
    await pool.query("UPDATE ci_order_alert SET status=$3,provider_message_id=coalesce($4,provider_message_id),accepted_at=CASE WHEN $3='accepted' THEN coalesce(accepted_at,now()) ELSE accepted_at END,last_error=$5,claimed_at=NULL,available_at=CASE WHEN $3='pending' THEN now()+($6||' seconds')::interval ELSE available_at END WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','sending')",[tenantId,row.id,status,acceptedId||null,message,String(whatsappBackoff(row.attempt_count))]);
   }
   return true;
  });
  if(!processed)break;claimed++;
 }
 return {claimed,uncertain:stale.rowCount,configured:true};
}

export const whatsappPublic=express.Router();
whatsappPublic.get('/webhook',(req,res)=>{
 const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],challenge=req.query['hub.challenge'];
 if(mode==='subscribe'&&process.env.WHATSAPP_VERIFY_TOKEN&&token===process.env.WHATSAPP_VERIFY_TOKEN&&typeof challenge==='string')return res.type('text/plain').send(challenge);
 res.sendStatus(403);
});
whatsappPublic.post('/webhook',express.raw({type:()=>true,limit:'1mb'}),async(req,res)=>{
 let persistenceStarted=false;
 try{
  const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
  if(!tenantId)return res.sendStatus(503);
  const signature=String(req.get('x-hub-signature-256')||''),secret=process.env.WHATSAPP_APP_SECRET;
  if(!secret||!/^sha256=[a-f0-9]{64}$/i.test(signature))return res.sendStatus(401);
  const expected=createHmac('sha256',secret).update(req.body).digest('hex');
  if(!timingSafeEqual(Buffer.from(signature.slice(7),'hex'),Buffer.from(expected,'hex')))return res.sendStatus(401);
  const payload=JSON.parse(req.body);
  if(payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return res.sendStatus(400);
  // Validate the entire batch before committing any individual status. Invalid
  // trailing input must not turn a partially handled batch into a retry loop.
  for(const entry of payload.entry){
   if(!entry||typeof entry!=='object'||(entry.changes!==undefined&&!Array.isArray(entry.changes)))return res.sendStatus(400);
   for(const change of entry.changes||[]){
    if(!change||typeof change!=='object')return res.sendStatus(400);
    const value=change.value;
    if(change.field!=='messages'||value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)continue;
    if(value.statuses!==undefined&&!Array.isArray(value.statuses))return res.sendStatus(400);
    if((value.statuses||[]).some(status=>!status||typeof status!=='object'||Array.isArray(status)))return res.sendStatus(400);
   }
  }
  for(const entry of payload.entry)for(const change of entry.changes||[]){
   const value=change.value;if(change.field!=='messages'||value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)continue;
   for(const status of value.statuses||[]){
    if(typeof status.id!=='string'||!['sent','delivered','read','failed'].includes(status.status))continue;
    persistenceStarted=true;
    await transaction(async db=>{
    const rank={accepted:0,sent:1,delivered:2,read:3};
    const row=(await db.query('SELECT id,tenant_id,order_id,status FROM ci_order_alert WHERE tenant_id=$2 AND provider_message_id=$1 FOR UPDATE',[status.id,tenantId])).rows[0];
    if(!row||row.status===status.status||row.status==='read'||row.status==='failed'||row.status==='cancelled'||(row.status==='delivered'&&['sent','failed'].includes(status.status)))return;
    if(status.status!=='failed'&&rank[status.status]<rank[row.status])return;
    await db.query("UPDATE ci_order_alert SET status=$2,delivered_at=CASE WHEN $2 IN ('delivered','read') THEN coalesce(delivered_at,now()) ELSE delivered_at END,last_error=$4 WHERE tenant_id=$3 AND id=$1",[row.id,status.status,tenantId,status.status==='failed'?metaErrorText(status.errors?.[0]||{title:'Meta reported delivery failure'}):null]);
    await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,$4,'{}') ON CONFLICT DO NOTHING`,[row.tenant_id,row.order_id,`whatsapp:${row.id}:${status.status}`,`whatsapp_${status.status}`]);
    });
   }
  }
  res.sendStatus(200);
 }catch{res.sendStatus(persistenceStarted?503:400);}
});
