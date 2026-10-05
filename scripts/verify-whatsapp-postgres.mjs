import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import express from 'express';
import { inventoryPool,migrateInventory,transaction } from '../inventory/db.js';
import { recordIncomingOrder } from '../inventory/unified-orders.js';
import { runWhatsAppBatch,withWhatsAppRateLimit,whatsappPublic } from '../inventory/whatsapp.js';
import { requestRecipientOtp,verifyRecipientOtp } from '../inventory/recipient-otp.js';
if(!/test|contract/.test(process.env.INVENTORY_DATABASE_URL||''))throw Error('Use an isolated test database');
await migrateInventory();
const db=inventoryPool(),tenant=`whatsapp-${randomUUID()}`,foreign=`foreign-${randomUUID()}`;
Object.assign(process.env,{INVENTORY_ALLOWED_TENANT_ID:tenant,WHATSAPP_GRAPH_VERSION:'v23.0',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_ACCESS_TOKEN:'fixture-private-token',WHATSAPP_APP_SECRET:'fixture-private-secret',WHATSAPP_VERIFY_TOKEN:'fixture-verify',WHATSAPP_ORDER_TEMPLATE:'approved_order',WHATSAPP_OTP_TEMPLATE:'approved_otp'});
try{
 const account=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id) VALUES($1,'shopify','fixture-shop') RETURNING id",[tenant])).rows[0];
 const recipient=(await db.query("INSERT INTO ci_alert_recipient(tenant_id,name,role,mobile_e164,consented_at,verified_at) VALUES($1,'Fixture','packer','+919876543210',now(),now()) RETURNING id",[tenant])).rows[0];
 const orderId=await transaction(tx=>recordIncomingOrder(tx,{tenantId:tenant,accountId:account.id,platform:'shopify',event:{id:'fresh',created_at:new Date().toISOString(),line_items:[{id:'line',sku:'TEE',quantity:1}]},topic:'orders/create',packingAlerts:false}));
 const alert=(await db.query('SELECT id FROM ci_order_alert WHERE tenant_id=$1 AND order_id=$2',[tenant,orderId])).rows[0];
 const reset=()=>db.query("UPDATE ci_order_alert SET status='pending',attempt_count=0,available_at=now(),provider_message_id=NULL,last_error=NULL WHERE tenant_id=$1 AND id=$2",[tenant,alert.id]);
 const state=async()=>(await db.query('SELECT status,last_error,provider_message_id,attempt_count,extract(epoch from available_at-now()) AS delay FROM ci_order_alert WHERE tenant_id=$1 AND id=$2',[tenant,alert.id])).rows[0];
 for(const [name,configure,expected] of [
  ['unverified',"verified_at=NULL",0],['unconsented',"consented_at=NULL",0],['muted',"muted=true",0],['inactive',"active=false",0],['event disabled',"event_types=ARRAY['packing_ready']",0],
  ['hours',"alert_start=((now() AT TIME ZONE 'Asia/Kolkata')::time+interval '2 hours')::time,alert_end=((now() AT TIME ZONE 'Asia/Kolkata')::time+interval '3 hours')::time",0],
 ]){
  await db.query(`UPDATE ci_alert_recipient SET ${configure} WHERE tenant_id=$1 AND id=$2`,[tenant,recipient.id]);
  let sends=0;assert.equal((await runWhatsAppBatch(1,async()=>{sends++;throw Error('Must not send');})).claimed,expected,name);assert.equal(sends,0,name);
  await db.query("UPDATE ci_alert_recipient SET verified_at=now(),consented_at=now(),muted=false,active=true,event_types=ARRAY['new_order'],alert_start=NULL,alert_end=NULL WHERE tenant_id=$1 AND id=$2",[tenant,recipient.id]);
 }
 for(const [code,http,expected] of [[190,503,'failed'],[132001,400,'failed'],[131030,400,'failed'],[130429,400,'pending'],[0,429,'pending'],[0,503,'pending']]){
  await reset();assert.equal((await runWhatsAppBatch(1,async(_url,options)=>{options.onDispatch();return {ok:false,status:http,json:async()=>({error:{code,error_subcode:9,message:'Rejected +919876543210 fixture-private-token'}})};})).claimed,1);
  const row=await state();assert.equal(row.status,expected);assert.match(row.last_error,new RegExp(`code=${code} subcode=9`));assert.ok(!row.last_error.includes('919876543210'));assert.ok(!row.last_error.includes('fixture-private-token'));
  if(expected==='pending')assert.ok(Number(row.delay)>55&&Number(row.delay)<=75);
  else assert.equal((await runWhatsAppBatch(1,async()=>{throw Error('Permanent failure must not resend');})).claimed,0);
 }
 await reset();process.env.WHATSAPP_ORDER_TEMPLATE='INVALID';let sends=0;
 await runWhatsAppBatch(1,async()=>{sends++;});assert.equal(sends,0);assert.equal((await state()).status,'failed');assert.match((await state()).last_error,/preparation.*template/);process.env.WHATSAPP_ORDER_TEMPLATE='approved_order';
 await reset();await runWhatsAppBatch(1,async()=>{throw Error('DNS failed before dispatch');});assert.equal((await state()).status,'failed');
 await reset();await runWhatsAppBatch(1,async(_url,options)=>{options.onDispatch();throw Error('Response lost after dispatch');});assert.equal((await state()).status,'uncertain');
 assert.equal((await runWhatsAppBatch(1,async()=>{throw Error('Must not retry uncertain');})).claimed,0);
 await reset();
 await db.query("CREATE FUNCTION codexqa_whatsapp_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='whatsapp_accepted' THEN RAISE EXCEPTION 'fixture acceptance audit unavailable'; END IF; RETURN NEW; END $$");
 await db.query('CREATE TRIGGER codexqa_whatsapp_audit_failure BEFORE INSERT ON ci_order_timeline FOR EACH ROW EXECUTE FUNCTION codexqa_whatsapp_audit_failure()');
 try{await runWhatsAppBatch(1,async()=>({ok:true,status:200,json:async()=>({messages:[{id:'wamid.accepted-fixture'}]})}));assert.equal((await state()).status,'accepted');assert.equal((await state()).provider_message_id,'wamid.accepted-fixture');assert.match((await state()).last_error,/audit requires review/);}
 finally{await db.query('DROP TRIGGER codexqa_whatsapp_audit_failure ON ci_order_timeline');await db.query('DROP FUNCTION codexqa_whatsapp_audit_failure()');}
 // Cross-session tenant pacing, including the web/worker shared limiter.
 const times=[];await Promise.all([1,2,3].map(()=>withWhatsAppRateLimit(tenant,async()=>{times.push(Date.now());})));
 assert.ok(times[1]-times[0]>=990&&times[2]-times[1]>=990,'Tenant send starts must be at least one second apart');
 const separate=[];await Promise.all([tenant,foreign].map(t=>withWhatsAppRateLimit(t,async()=>{separate.push(Date.now());})));assert.ok(Math.abs(separate[1]-separate[0])<750,'Different tenants must not share a limiter');
 const app=express();app.use('/whatsapp',whatsappPublic);const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try{
  const callback=async(status,error,signatureMode='valid')=>{
   const body=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},statuses:[{id:'wamid.accepted-fixture',status,errors:error?[error]:[]}]}}]}]}));
   const signature='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
   return fetch(`http://127.0.0.1:${server.address().port}/whatsapp/webhook`,{method:'POST',headers:{'content-type':'application/json',...(signatureMode==='absent'?{}:{'x-hub-signature-256':signatureMode==='bad'?'sha256='+'0'.repeat(64):signature})},body});
  };
  process.env.INVENTORY_ALLOWED_TENANT_ID=foreign;assert.equal((await callback('delivered')).status,200);assert.equal((await state()).status,'accepted');
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;assert.equal((await callback('delivered')).status,503);process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
  assert.equal((await callback('delivered',null,'bad')).status,401);assert.equal((await callback('delivered',null,'absent')).status,401);
  assert.equal((await callback('failed',{code:131026,title:'Recipient +919876543210 unavailable'})).status,200);assert.equal((await state()).status,'failed');assert.match((await state()).last_error,/code=131026/);
  await callback('sent');assert.equal((await state()).status,'failed');
  await db.query("UPDATE ci_order_alert SET status='accepted' WHERE tenant_id=$1 AND id=$2",[tenant,alert.id]);
  for(const status of ['delivered','sent','failed','read','sent'])await callback(status);assert.equal((await state()).status,'read');
 }finally{await new Promise(resolve=>server.close(resolve));}
 const otpRecipient=(await db.query("INSERT INTO ci_alert_recipient(tenant_id,name,role,mobile_e164,consented_at,active) VALUES($1,'OTP fixture','manager','+919876543211',now(),false) RETURNING id",[tenant])).rows[0];let code;
 const options={tenantId:tenant,recipientId:otpRecipient.id,pool:db,fetcher:async(_url,options)=>{code=JSON.parse(options.body).template.components[0].parameters[0].text;return {ok:true,json:async()=>({messages:[{id:'wamid.otp'}]})};}};
 await requestRecipientOtp(options);await assert.rejects(()=>requestRecipientOtp(options),e=>e.status===429);
 const wrong=code==='000000'?'111111':'000000';for(let n=0;n<5;n++)await assert.rejects(()=>verifyRecipientOtp({...options,code:wrong}),e=>e.status===(n===4?429:400));
 assert.equal((await db.query('SELECT status FROM ci_recipient_verification WHERE tenant_id=$1 AND recipient_id=$2',[tenant,otpRecipient.id])).rows[0].status,'locked');
 await db.query("UPDATE ci_recipient_verification SET requested_at=now()-interval '61 seconds',window_count=10 WHERE tenant_id=$1 AND recipient_id=$2",[tenant,otpRecipient.id]);await assert.rejects(()=>requestRecipientOtp(options),e=>e.status===429);
 await db.query("UPDATE ci_recipient_verification SET window_count=1 WHERE tenant_id=$1 AND recipient_id=$2",[tenant,otpRecipient.id]);await requestRecipientOtp(options);assert.equal((await verifyRecipientOtp({...options,code})).verified,true);
 console.log('PASS isolated PostgreSQL WhatsApp: consent/OTP/mute/hours/events, preparation failure, dispatch uncertainty, Meta codes/retry/jitter, acceptance persistence fault, tenant rate serialization, signed callback tenant/auth/order/failure codes, OTP cooldown/cap/lockout');
}finally{await db.end();}
