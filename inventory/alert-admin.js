import express from 'express';
import { inventoryPool,transaction } from './db.js';
import { connectionCatalog } from './connection-catalog.js';
import { salesPrograms } from './sales-programs.js';
import { orderAlertPolicy } from './order-alert-policy.js';
import { whatsappSafeText,whatsappReady,whatsappTemplatePayload,whatsappFetch,withWhatsAppRateLimit,metaErrorText } from './whatsapp.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status,publicFailure:true});};
export const maskedRecipient=row=>({...row,mobile_e164:`***${String(row.mobile_e164||'').slice(-4)}`});
export function requireAlertAdmin(req,res,next){
 if(!req.user)return res.status(401).json({error:'Sign in to manage WhatsApp alerts'});
 if(!process.env.DMILLS_ADMIN_USER||req.user.username!==process.env.DMILLS_ADMIN_USER)return res.status(403).json({error:'Administrator access required'});
 if(!req.inventoryTenantId)return res.status(503).json({error:'Inventory tenant is not configured'});
 next();
}
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.publicFailure?e.status:e.code==='23505'||e.code==='23503'?409:503).json({error:e.publicFailure?e.message:e.code==='23505'?'Name or request already exists':e.code==='23503'?'A referenced record changed; refresh and retry':'Alert administration unavailable'});}};
const audit=(db,tenant,operator,action,subject,detail={})=>db.query('INSERT INTO ci_alert_admin_audit(tenant_id,operator,action,subject_id,detail) VALUES($1,$2,$3,$4,$5)',[tenant,operator,action,subject,detail]);
const checkId=id=>{if(!uuid.test(id||''))fail(400,'Invalid identifier');return id;};
const owns=async(db,table,tenant,id)=>{checkId(id);const row=(await db.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,id])).rows[0];if(!row)fail(404,'Record not found');return row;};
const text=(value,max,label,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(400,`Invalid ${label}`);return value.trim();};
const teamInput=body=>{if(typeof body.active!=='boolean'||!['packing','informational'].includes(body.kind))fail(400,'Choose team kind and active state');return {name:text(body.name,120,'team name',true),description:text(body.description||'',500,'description'),kind:body.kind,instruction:whatsappSafeText(text(body.instruction||'Review observed order',120,'instruction',true)),active:body.active};};
const ruleKeys=['platform','programme','account_id','location_id','sku_prefix','sku_group_id','payment_mode','source_type'];
async function ruleInput(db,tenant,body){
 if(Object.keys(body).some(k=>!ruleKeys.includes(k)))fail(400,'Unsupported rule matcher');
 const rule=Object.fromEntries(ruleKeys.map(key=>[key,body[key]===''||body[key]==null?null:body[key]]));
 for(const key of ruleKeys)if(rule[key]!==null&&typeof rule[key]!=='string')fail(400,'Rule matchers must be strings');
 if(rule.platform&&!connectionCatalog.some(p=>p.key===rule.platform))fail(400,'Unknown platform');
 const program=salesPrograms.find(p=>p.key===rule.programme);if(rule.programme&&!program)fail(400,'Unknown programme');
 if(rule.platform&&program&&!program.parents.includes(rule.platform))fail(400,'Programme does not belong to this platform');
 if(rule.source_type&&!['live','report'].includes(rule.source_type))fail(400,'Unknown source type');
 if(rule.sku_prefix)text(rule.sku_prefix,120,'SKU prefix',true);if(rule.payment_mode)text(rule.payment_mode,80,'payment mode',true);
 for(const [key,table] of [['account_id','ci_channel_account'],['location_id','ci_location'],['sku_group_id','ci_alert_sku_group']])if(rule[key]){
  const row=await owns(db,table,tenant,rule[key]);
  if(key==='location_id'&&!['warehouse','store'].includes(row.location_type))fail(400,'Warehouse rule requires a physical warehouse or store');
  if(key==='account_id'&&((rule.platform&&row.platform!==rule.platform)||(program&&!program.parents.includes(row.platform))))fail(400,'Account conflicts with platform or programme');
 }
 return rule;
}
export async function sendTeamTest({tenantId,teamId,recipientId,operator,requestId,fetcher=whatsappFetch}){
 checkId(teamId);checkId(recipientId);checkId(requestId);
 return withWhatsAppRateLimit(tenantId,async()=>{
  let dispatched=false,acceptedId,attempt,body;
  const prepared=await transaction(async db=>{
   const prior=(await db.query('SELECT id,team_id,recipient_id,status,last_error FROM ci_alert_test_attempt WHERE tenant_id=$1 AND request_id=$2',[tenantId,requestId])).rows[0];
   if(prior){if(prior.team_id!==teamId||prior.recipient_id!==recipientId)fail(409,'Test request ID already used for another member');return {prior};}
   const team=await owns(db,'ci_alert_team',tenantId,teamId);
   const member=(await db.query(`SELECT r.* FROM ci_alert_recipient r JOIN ci_alert_team_member m ON m.tenant_id=r.tenant_id AND m.recipient_id=r.id
    WHERE r.tenant_id=$1 AND r.id=$2 AND m.team_id=$3 AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
    AND (r.alert_start IS NULL OR (r.alert_start<r.alert_end AND (now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start AND (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)
     OR (r.alert_start>r.alert_end AND ((now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start OR (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end))) FOR UPDATE OF r`,[tenantId,recipientId,teamId])).rows[0];
   if(!team.active||!member)fail(409,'Test requires an active team and an active, unmuted, consented, verified member within alert hours');
   const event=team.kind==='informational'?'order_observed':member.event_types.includes('new_order')?'new_order':'packing_ready';
   if(!member.event_types.includes(event))fail(409,'Member does not subscribe to this team’s alert event');
   const recent=await db.query("SELECT 1 FROM ci_alert_test_attempt WHERE tenant_id=$1 AND recipient_id=$2 AND created_at>now()-interval '1 minute'",[tenantId,recipientId]);if(recent.rowCount)fail(429,'Wait one minute before another test for this member');
   attempt=(await db.query("INSERT INTO ci_alert_test_attempt(tenant_id,request_id,team_id,recipient_id,operator,status) VALUES($1,$2,$3,$4,$5,'sending') RETURNING id",[tenantId,requestId,teamId,recipientId,operator])).rows[0].id;
   await audit(db,tenantId,operator,'test_requested',attempt,{teamId,recipientId});
   return {row:{mobile_e164:member.mobile_e164,platform:'Team test',external_order_id:'TEST',team_kind:team.kind,team_instruction:team.instruction,event_type:event}};
  });
  if(prepared.prior)return {...prepared.prior,replayed:true};
  let status='failed',lastError=null;
  try{
   if(!whatsappReady())throw Error('Configure the Meta sender and approved template first');
   body=JSON.stringify(whatsappTemplatePayload(prepared.row,[]));
   const response=await fetcher(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body,onDispatch:()=>{dispatched=true;}});
   dispatched=true;const result=await response.json();
   if(!response.ok){lastError=metaErrorText(result?.error||{},response.status);status='failed';}
   else if(typeof result?.messages?.[0]?.id==='string'&&result.messages[0].id.startsWith('wamid.')){acceptedId=result.messages[0].id;status='accepted';}
   else{status='uncertain';lastError='Meta did not confirm test-message acceptance; review delivery before another test';}
  }catch(e){status=dispatched?'uncertain':'failed';lastError=`${dispatched?'Dispatched test outcome unknown':'Test preparation failed'}: ${whatsappSafeText(e.message)}`;}
  await inventoryPool().query('UPDATE ci_alert_test_attempt SET status=$3,last_error=$4,provider_message_id=$5 WHERE tenant_id=$1 AND id=$2',[tenantId,attempt,status,lastError,acceptedId||null]);
  return {id:attempt,status,last_error:lastError,replayed:false};
 });
}
export function alertAdminApi({fetcher=whatsappFetch}={}){
 const router=express.Router();router.use(requireAlertAdmin);
 router.get('/catalog',wrap(async(req,res)=>{
  const t=req.inventoryTenantId;const results=await Promise.all([
   inventoryPool().query('SELECT id,platform,external_account_id FROM ci_channel_account WHERE tenant_id=$1 ORDER BY platform,external_account_id',[t]),
   inventoryPool().query("SELECT id,code FROM ci_location WHERE tenant_id=$1 AND location_type IN ('warehouse','store') ORDER BY code",[t]),
   inventoryPool().query('SELECT id,name FROM ci_alert_sku_group WHERE tenant_id=$1 ORDER BY name',[t]),
   inventoryPool().query('SELECT id,sku FROM ci_master_sku WHERE tenant_id=$1 ORDER BY sku LIMIT 1000',[t])]);
  res.json({platforms:connectionCatalog.map(p=>({key:p.key,name:p.name})),programmes:salesPrograms.map(p=>({key:p.key,name:p.name,parents:p.parents})),accounts:results[0].rows,locations:results[1].rows,groups:results[2].rows,skus:results[3].rows});
 }));
 router.get('/teams',wrap(async(req,res)=>{
  const rows=await inventoryPool().query(`SELECT t.*,coalesce((SELECT jsonb_agg(m.recipient_id ORDER BY m.recipient_id) FROM ci_alert_team_member m WHERE m.tenant_id=t.tenant_id AND m.team_id=t.id),'[]') AS members,
   coalesce((SELECT jsonb_agg(r ORDER BY r.created_at,r.id) FROM ci_alert_team_rule r WHERE r.tenant_id=t.tenant_id AND r.team_id=t.id),'[]') AS rules FROM ci_alert_team t WHERE t.tenant_id=$1 ORDER BY t.name`,[req.inventoryTenantId]);res.json(rows.rows);
 }));
 router.post('/teams',wrap(async(req,res)=>{const input=teamInput(req.body);const row=await transaction(async db=>{const row=(await db.query('INSERT INTO ci_alert_team(tenant_id,name,description,kind,instruction,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.inventoryTenantId,input.name,input.description,input.kind,input.instruction,input.active])).rows[0];await audit(db,req.inventoryTenantId,req.user.username,'team_created',row.id);return row;});res.status(201).json(row);}));
 router.post('/teams/:id',wrap(async(req,res)=>{const input=teamInput(req.body);const row=await transaction(async db=>{const prior=await owns(db,'ci_alert_team',req.inventoryTenantId,req.params.id);const row=(await db.query('UPDATE ci_alert_team SET name=$3,description=$4,kind=$5,instruction=$6,active=$7,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',[req.inventoryTenantId,req.params.id,input.name,input.description,input.kind,input.instruction,input.active])).rows[0];if(prior.kind!==input.kind)await db.query("UPDATE ci_order_alert SET status='cancelled',last_error='Team purpose changed; queued notification cancelled' WHERE tenant_id=$1 AND team_id=$2 AND status='pending' AND (($3='informational' AND event_type<>'order_observed') OR ($3='packing' AND event_type='order_observed'))",[req.inventoryTenantId,row.id,input.kind]);await audit(db,req.inventoryTenantId,req.user.username,'team_updated',row.id,{active:input.active,previousKind:prior.kind,kind:input.kind});return row;});res.json(row);}));
 router.post('/teams/:id/members',wrap(async(req,res)=>{const members=req.body.recipientIds;if(!Array.isArray(members)||members.length>200||members.some(id=>!uuid.test(id)))fail(400,'Choose valid members');await transaction(async db=>{await owns(db,'ci_alert_team',req.inventoryTenantId,req.params.id);for(const id of new Set(members))await owns(db,'ci_alert_recipient',req.inventoryTenantId,id);await db.query('DELETE FROM ci_alert_team_member WHERE tenant_id=$1 AND team_id=$2',[req.inventoryTenantId,req.params.id]);for(const id of new Set(members))await db.query('INSERT INTO ci_alert_team_member(tenant_id,team_id,recipient_id) VALUES($1,$2,$3)',[req.inventoryTenantId,req.params.id,id]);await audit(db,req.inventoryTenantId,req.user.username,'team_members_updated',req.params.id,{recipientIds:[...new Set(members)]});});res.json({ok:true});}));
 router.post('/teams/:id/rules',wrap(async(req,res)=>{const row=await transaction(async db=>{await owns(db,'ci_alert_team',req.inventoryTenantId,req.params.id);const rule=await ruleInput(db,req.inventoryTenantId,req.body);const row=(await db.query(`INSERT INTO ci_alert_team_rule(tenant_id,team_id,${ruleKeys.join(',')}) VALUES($1,$2,${ruleKeys.map((_,i)=>'$'+(i+3)).join(',')}) RETURNING *`,[req.inventoryTenantId,req.params.id,...ruleKeys.map(k=>rule[k])])).rows[0];await audit(db,req.inventoryTenantId,req.user.username,'rule_created',row.id);return row;});res.status(201).json(row);}));
 router.post('/teams/:id/rules/:ruleId',wrap(async(req,res)=>{const row=await transaction(async db=>{await owns(db,'ci_alert_team',req.inventoryTenantId,req.params.id);const prior=await owns(db,'ci_alert_team_rule',req.inventoryTenantId,req.params.ruleId);if(prior.team_id!==req.params.id)fail(404,'Rule not found in this team');const rule=await ruleInput(db,req.inventoryTenantId,req.body);const row=(await db.query(`UPDATE ci_alert_team_rule SET ${ruleKeys.map((k,i)=>k+'=$'+(i+4)).join(',')},updated_at=now() WHERE tenant_id=$1 AND id=$2 AND team_id=$3 RETURNING *`,[req.inventoryTenantId,req.params.ruleId,req.params.id,...ruleKeys.map(k=>rule[k])])).rows[0];await audit(db,req.inventoryTenantId,req.user.username,'rule_updated',row.id);return row;});res.json(row);}));
 router.delete('/teams/:id/rules/:ruleId',wrap(async(req,res)=>{await transaction(async db=>{await owns(db,'ci_alert_team',req.inventoryTenantId,req.params.id);const result=await db.query('DELETE FROM ci_alert_team_rule WHERE tenant_id=$1 AND id=$2 AND team_id=$3 RETURNING id',[req.inventoryTenantId,checkId(req.params.ruleId),req.params.id]);if(!result.rowCount)fail(404,'Rule not found');await audit(db,req.inventoryTenantId,req.user.username,'rule_deleted',req.params.ruleId);});res.json({ok:true});}));
 router.post('/sku-groups',wrap(async(req,res)=>{const name=text(req.body.name,120,'group name',true),ids=req.body.skuIds;if(!Array.isArray(ids)||!ids.length||ids.length>1000)fail(400,'Choose group SKUs');const row=await transaction(async db=>{for(const id of new Set(ids))await owns(db,'ci_master_sku',req.inventoryTenantId,id);const row=(await db.query('INSERT INTO ci_alert_sku_group(tenant_id,name) VALUES($1,$2) RETURNING id,name',[req.inventoryTenantId,name])).rows[0];for(const id of new Set(ids))await db.query('INSERT INTO ci_alert_sku_group_member(tenant_id,group_id,master_sku_id) VALUES($1,$2,$3)',[req.inventoryTenantId,row.id,id]);await audit(db,req.inventoryTenantId,req.user.username,'sku_group_created',row.id);return row;});res.status(201).json(row);}));
 router.get('/teams/:id/test-attempts',wrap(async(req,res)=>{checkId(req.params.id);const rows=await inventoryPool().query('SELECT id,status,last_error,operator,created_at FROM ci_alert_test_attempt WHERE tenant_id=$1 AND team_id=$2 ORDER BY created_at DESC LIMIT 20',[req.inventoryTenantId,req.params.id]);res.json(rows.rows.map(row=>({...row,last_error:row.last_error?whatsappSafeText(row.last_error):null})));}));
 router.post('/teams/:id/test',wrap(async(req,res)=>res.json(await sendTeamTest({tenantId:req.inventoryTenantId,teamId:req.params.id,recipientId:req.body.recipientId,operator:req.user.username,requestId:req.body.requestId,fetcher}))));
 router.get('/orders/:id/alerts',wrap(async(req,res)=>{
  checkId(req.params.id);const rows=await inventoryPool().query(`SELECT a.id,a.event_type,a.status,a.last_error,a.attempt_count,a.available_at,a.accepted_at,a.delivered_at,a.team_id,t.name AS team_name,r.name AS recipient_name,r.mobile_e164,
   coalesce((SELECT jsonb_agg(jsonb_build_object('action',x.action,'operator',x.operator,'detail',x.detail,'created_at',x.created_at) ORDER BY x.created_at) FROM ci_alert_admin_audit x WHERE x.tenant_id=a.tenant_id AND x.subject_id=a.id),'[]') AS reviews
   FROM ci_order_alert a JOIN ci_alert_recipient r ON r.tenant_id=a.tenant_id AND r.id=a.recipient_id LEFT JOIN ci_alert_team t ON t.tenant_id=a.tenant_id AND t.id=a.team_id WHERE a.tenant_id=$1 AND a.order_id=$2 ORDER BY a.id`,[req.inventoryTenantId,req.params.id]);res.json(rows.rows.map(row=>({...maskedRecipient(row),last_error:row.last_error?whatsappSafeText(row.last_error):null})));
 }));
 router.post('/orders/:id/alerts/:alertId/review',wrap(async(req,res)=>{
  const {action,note,confirmUnknown}=req.body;if(!['reviewed','requeue'].includes(action))fail(400,'Choose review or re-queue');const safeNote=whatsappSafeText(text(note,300,'review note',true));checkId(req.params.id);
  const row=await transaction(async db=>{const t=req.inventoryTenantId,a=await owns(db,'ci_order_alert',t,req.params.alertId);if(a.order_id!==req.params.id)fail(404,'Alert not found for order');
   if(action==='requeue'){
    if(!['failed','uncertain'].includes(a.status))fail(409,'Only failed or uncertain alerts can be re-queued');
    if(a.status==='uncertain'&&confirmUnknown!==true)fail(409,'Confirm delivery was checked; re-queueing an uncertain alert may duplicate a message');
    const policy=await orderAlertPolicy(db,{tenantId:t,orderId:a.order_id});if(!policy.enabled||(policy.informationalOnly&&a.event_type!=='order_observed')||(a.event_type==='packing_ready'&&!policy.packingAllowed))fail(409,'Order policy or freshness does not permit re-queueing');
    const r=await owns(db,'ci_alert_recipient',t,a.recipient_id);if(!r.active||r.muted||!r.verified_at||!r.consented_at||(!r.event_types.includes(a.event_type)&&!(a.event_type==='new_order'&&r.event_types.includes('order_observed'))))fail(409,'Recipient is not eligible for this alert event');const indiaTime=new Date(Date.now()+330*60000).toISOString().slice(11,19);if(r.alert_start&&!(r.alert_start<r.alert_end?indiaTime>=r.alert_start&&indiaTime<r.alert_end:indiaTime>=r.alert_start||indiaTime<r.alert_end))fail(409,'Recipient is outside alert hours');
    if(a.team_id){const team=await owns(db,'ci_alert_team',t,a.team_id);const m=await db.query('SELECT 1 FROM ci_alert_team_member WHERE tenant_id=$1 AND team_id=$2 AND recipient_id=$3',[t,a.team_id,a.recipient_id]);if(!team.active||!m.rowCount||(team.kind==='informational'&&a.event_type!=='order_observed')||(team.kind==='packing'&&a.event_type==='order_observed'))fail(409,'Team membership or alert event is not active');}
    await db.query("UPDATE ci_order_alert SET status='pending',attempt_count=0,available_at=now(),claimed_at=NULL,provider_message_id=NULL,accepted_at=NULL,delivered_at=NULL WHERE tenant_id=$1 AND id=$2",[t,a.id]);
   }
   await audit(db,t,req.user.username,action,a.id,{note:safeNote,previousStatus:a.status,previousError:a.last_error?whatsappSafeText(a.last_error):null,previousProviderMessageId:a.provider_message_id,confirmUnknown:confirmUnknown===true});return {ok:true,status:action==='requeue'?'pending':a.status};});res.json(row);
 }));
 return router;
}
