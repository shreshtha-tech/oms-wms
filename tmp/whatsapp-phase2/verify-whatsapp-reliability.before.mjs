import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { inventoryPool } from '../inventory/db.js';
import { runWhatsAppBatch,whatsappPublic,whatsappTemplatePayload,metaRetryable,metaErrorText,whatsappBackoff,withWhatsAppRateLimit } from '../inventory/whatsapp.js';
import { requestRecipientOtp,verifyRecipientOtp } from '../inventory/recipient-otp.js';

// No provider or database network calls: exercise imported production functions.
process.env.INVENTORY_DATABASE_URL='postgres://fixture:fixture@localhost/whatsapp_test';
Object.assign(process.env,{INVENTORY_ALLOWED_TENANT_ID:'tenant-a',WHATSAPP_GRAPH_VERSION:'v23.0',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_ACCESS_TOKEN:'fixture-private-token',WHATSAPP_APP_SECRET:'fixture-private-secret',WHATSAPP_VERIFY_TOKEN:'fixture-private-verify',WHATSAPP_ORDER_TEMPLATE:'approved_order',WHATSAPP_OTP_TEMPLATE:'approved_otp'});
const pool=inventoryPool(),phone='+919876543210';
let state,queries=[],failureStage,callbackRow,otpRow,challenge,sendCode,selected=false;
const row=()=>({id:'alert',tenant_id:'tenant-a',order_id:'order',event_type:'new_order',attempt_count:0,mobile_e164:phone,platform:'shopify',external_order_id:'order-1'});
pool.query=async(sql,args=[])=>{
 queries.push({sql,args});
 if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
 if(/\b(?:SELECT|UPDATE)\b/.test(sql)&&/ci_order_alert|ci_alert_recipient|ci_recipient_verification/.test(sql))assert.ok(sql.includes('tenant_id'),'Every sender SELECT/UPDATE must carry tenant_id');
 if(sql.startsWith('SELECT a.id')){if(selected)return {rows:[]};selected=true;return {rows:[row()]};}
 if(sql.startsWith('SELECT seller_sku')){if(failureStage==='lines')throw Error('DB echoed '+phone+' '+process.env.WHATSAPP_ACCESS_TOKEN);if(failureStage==='config')process.env.WHATSAPP_GRAPH_VERSION='invalid';return {rows:[{seller_sku:'TEE',quantity:2}]};}
 if(sql.startsWith('SELECT id,tenant_id'))return {rows:callbackRow&&callbackRow.tenant_id===args[1]?[callbackRow]:[]};
 if(sql.startsWith('SELECT id,mobile_e164'))return {rows:otpRow?[otpRow]:[]};
 if(sql.startsWith('SELECT id,verified_at'))return {rows:otpRow?[otpRow]:[]};
 if(sql.startsWith('SELECT requested_at'))return {rows:challenge?[{...challenge}]:[]};
 if(sql.startsWith('SELECT challenge_id'))return {rows:challenge?[{...challenge}]:[]};
 if(sql.startsWith('INSERT INTO ci_recipient_verification')){challenge={challenge_id:args[2],code_hash:args[3],expires_at:new Date(Date.now()+600000),status:'sending',attempts:0,requested_at:new Date(),window_start:new Date(),window_count:1};}
 if(sql.startsWith('UPDATE ci_recipient_verification')){
  if(sql.includes("status='sent'"))challenge.status='sent';
  if(sql.includes("status='failed'"))challenge.status='failed';
  if(sql.includes('attempts=attempts+1')){challenge.attempts++;if(challenge.attempts>=5)challenge.status='locked';}
  if(sql.includes("status='verified'"))challenge.status='verified';
  return {rowCount:1,rows:[{expires_at:challenge?.expires_at}]};
 }
 if(sql.startsWith('UPDATE ci_alert_recipient')){otpRow.verified_at=new Date();otpRow.active=Boolean(otpRow.consented_at);}
 if(sql.startsWith('UPDATE ci_order_alert')&&args[0]==='tenant-a'&&args[1]==='alert'){
  if(sql.includes("SET status='sending'"))state='sending';
  else if(sql.includes("status='accepted'")){if(failureStage==='accepted'){failureStage=null;throw Error('fixture acceptance persistence outage');}state='accepted';}
  else if(sql.includes('status=$3')){if(failureStage==='rejection-write'){failureStage=null;throw Error('fixture rejection persistence outage');}state=args[2];}
 }
 if(sql.startsWith('UPDATE ci_order_alert')&&callbackRow&&args[0]===callbackRow.id){callbackRow.status=args[1];callbackRow.last_error=args[3];}
 if(sql.startsWith('INSERT INTO ci_order_timeline')&&failureStage==='timeline'){failureStage=null;throw Error('fixture timeline outage');}
 return {rows:[],rowCount:1};
};
pool.connect=async()=>({query:(...args)=>pool.query(...args),release:()=>{}});
const reject=(status,code)=>async(_url,options)=>{options.onDispatch();return {ok:false,status,json:async()=>({error:{code,error_subcode:42,message:`Rejected ${phone} ${process.env.WHATSAPP_ACCESS_TOKEN}`}})};};
for(const test of [
 {name:'line lookup',stage:'lines',expected:'failed',sends:0},
 {name:'invalid template',template:'INVALID',expected:'failed',sends:0},
 {name:'config changed during preparation',stage:'config',expected:'failed',sends:0},
 {name:'invalid language',language:'invalid!',expected:'failed',sends:0},
 {name:'serialization',serialization:true,expected:'failed',sends:0},
 {name:'pre-dispatch transport',fetcher:async()=>{throw Error('DNS preparation failed');},expected:'failed',sends:1},
 {name:'post-dispatch network',fetcher:async(_url,options)=>{options.onDispatch();throw Error('network lost');},expected:'uncertain',sends:1},
 {name:'missing acceptance id',fetcher:async()=>({ok:true,status:200,json:async()=>({})}),expected:'uncertain',sends:1},
 {name:'permanent token',fetcher:reject(503,190),expected:'failed',sends:1},
 {name:'permanent template',fetcher:reject(400,132001),expected:'failed',sends:1},
 {name:'recipient not allowed',fetcher:reject(400,131030),expected:'failed',sends:1},
 {name:'429',fetcher:reject(429,0),expected:'pending',sends:1},
 {name:'503',fetcher:reject(503,0),expected:'pending',sends:1},
 {name:'throughput HTTP 400',fetcher:reject(400,130429),expected:'pending',sends:1},
 {name:'rejection write fault',stage:'rejection-write',fetcher:reject(400,132001),expected:'failed',sends:1},
 {name:'null after dispatch',fetcher:async(_url,options)=>{options.onDispatch();throw null;},expected:'uncertain',sends:1},
 {name:'acceptance write fault',stage:'accepted',expected:'accepted',sends:1},
 {name:'timeline write fault',stage:'timeline',expected:'accepted',sends:1},
]){
 queries=[];selected=false;failureStage=test.stage;state='pending';let sends=0;
 process.env.WHATSAPP_GRAPH_VERSION='v23.0';
 process.env.WHATSAPP_ORDER_TEMPLATE=test.template||'approved_order';process.env.WHATSAPP_TEMPLATE_LANGUAGE=test.language||'en_US';
 const stringify=JSON.stringify;
 if(test.serialization)JSON.stringify=function(value,...args){if(value?.messaging_product==='whatsapp')throw Error('Cannot serialize payload');return stringify(value,...args);};
 try{assert.equal((await runWhatsAppBatch(1,async(...args)=>{sends++;return test.fetcher?test.fetcher(...args):{ok:true,status:200,json:async()=>({messages:[{id:'wamid.fixture'}]})};})).claimed,1);}
 finally{JSON.stringify=stringify;}
 assert.equal(state,test.expected,test.name);assert.equal(sends,test.sends,test.name);
 const errors=queries.filter(q=>q.sql.startsWith('UPDATE ci_order_alert')).flatMap(q=>q.args.filter(x=>typeof x==='string'&&x.includes('Meta')||typeof x==='string'&&x.includes('preparation')));
 for(const error of errors){assert.ok(!error.includes(phone));assert.ok(!error.includes(process.env.WHATSAPP_ACCESS_TOKEN));}
 if(test.expected==='pending'){const retry=queries.find(q=>q.args[2]==='pending');assert.ok(Number(retry.args[3])>=60&&Number(retry.args[3])<=75);assert.match(retry.args[4],/code=.*subcode=42/);}
 if(!sends)assert.ok(!queries.some(q=>q.args[1]==='alert'&&q.sql.startsWith('UPDATE ci_order_alert')&&q.sql.includes("SET status='sending'")),'Preparation must finish before send state');
 console.log(`PASS ${test.name}: ${state}`);
}
process.env.WHATSAPP_ORDER_TEMPLATE='approved_order';process.env.WHATSAPP_TEMPLATE_LANGUAGE='en_US';
for(const code of [190,131030,132001,132015,132016])assert.equal(metaRetryable(500,{code}),false);
for(const code of [130429,131048,131056,131016])assert.equal(metaRetryable(400,{code}),true);
for(let n=0;n<20;n++){const delay=whatsappBackoff(2);assert.ok(delay>=120&&delay<=150);}
assert.equal(whatsappTemplatePayload({...row(),external_order_id:'ID\n\t    value'},[{seller_sku:'A\n    B',quantity:1}]).template.components[0].parameters.length,4);
assert.ok(!/[\n\t]| {4,}/.test(JSON.stringify(whatsappTemplatePayload(row(),[{seller_sku:'A\n    B',quantity:1}]).template.components[0].parameters)));
assert.ok(!metaErrorText({code:131030,message:phone+' fixture-private-token'}).includes(phone));

// Real Express raw-body middleware and signatures, fake database only.
const app=express();app.use('/whatsapp',whatsappPublic);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
 const send=async(status,signatureMode='valid',tenant='tenant-a',error)=>{
  if(tenant===null)delete process.env.INVENTORY_ALLOWED_TENANT_ID;else process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
  const body=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},statuses:[{id:'wamid.fixture',status,errors:error?[error]:[]}]}}]}]}));
  const signature='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
  return fetch(`http://127.0.0.1:${server.address().port}/whatsapp/webhook`,{method:'POST',headers:{'content-type':'application/json',...(signatureMode==='absent'?{}:{'x-hub-signature-256':signatureMode==='bad'?'sha256='+'0'.repeat(64):signature})},body});
 };
 callbackRow={id:'callback',tenant_id:'tenant-b',order_id:'order',status:'accepted'};
 assert.equal((await send('delivered')).status,200);assert.equal(callbackRow.status,'accepted');
 assert.equal((await send('delivered','valid',null)).status,503);
 assert.equal((await send('delivered','bad')).status,401);assert.equal((await send('delivered','absent')).status,401);
 callbackRow={id:'callback',tenant_id:'tenant-a',order_id:'order',status:'accepted'};
 for(const status of ['delivered','sent','failed','read','sent']){assert.equal((await send(status)).status,200);}
 assert.equal(callbackRow.status,'read');
 callbackRow.status='accepted';assert.equal((await send('failed','valid','tenant-a',{code:131026,title:'Delivery failed '+phone})).status,200);
 assert.match(callbackRow.last_error,/code=131026.*Delivery failed/);assert.ok(!callbackRow.last_error.includes(phone));
 await send('sent');assert.equal(callbackRow.status,'failed');
 console.log('PASS raw-body signed callbacks: tenant boundary, 503, bad/absent signature 401, ordering and failure codes');
}finally{await new Promise(resolve=>server.close(resolve));}

// Actual limiter minimum hold; database advisory-lock serialization is checked in PostgreSQL suite.
queries=[];let invoked=false;const start=Date.now();await withWhatsAppRateLimit('tenant-a',async()=>{invoked=true;});assert.ok(invoked);assert.ok(Date.now()-start>=990);assert.ok(queries.some(q=>q.sql.includes('pg_try_advisory_lock')&&q.args[0]==='whatsapp-send:tenant-a'));assert.ok(queries.some(q=>q.sql.includes('pg_advisory_unlock')));

queries=[];otpRow={id:'recipient',mobile_e164:phone,verified_at:null,consented_at:new Date()};challenge=null;
const settings={...process.env};
const otpFetch=async(_url,options)=>{sendCode=JSON.parse(options.body).template.components[0].parameters[0].text;return {ok:true,json:async()=>({messages:[{id:'wamid.otp'}]})};};
await requestRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',pool,fetcher:otpFetch,settings});
assert.ok(!JSON.stringify(challenge).includes(sendCode),'Only HMAC digest is persisted');
await assert.rejects(()=>requestRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',pool,fetcher:otpFetch,settings}),error=>error.status===429);
challenge.requested_at=new Date(Date.now()-61000);challenge.window_count=10;
await assert.rejects(()=>requestRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',pool,fetcher:otpFetch,settings}),error=>error.status===429);
challenge.window_count=1;
const wrong=sendCode==='000000'?'111111':'000000';
for(let n=0;n<5;n++)await assert.rejects(()=>verifyRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',code:wrong,settings}),error=>error.status===(n===4?429:400));
assert.equal(challenge.status,'locked');
await assert.rejects(()=>verifyRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',code:sendCode,settings}),error=>error.status===409);
challenge.status='sent';challenge.attempts=0;challenge.expires_at=new Date(Date.now()-1);
await assert.rejects(()=>verifyRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',code:sendCode,settings}),error=>error.status===409);
challenge.expires_at=new Date(Date.now()+600000);otpRow.consented_at=null;
assert.equal((await verifyRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',code:sendCode,settings})).verified,true);assert.equal(otpRow.active,false);
otpRow.verified_at=null;challenge.requested_at=new Date(Date.now()-61000);
await assert.rejects(()=>requestRecipientOtp({tenantId:'tenant-a',recipientId:'recipient',pool,settings,fetcher:async()=>{throw Object.assign(Error(phone+' '+settings.WHATSAPP_ACCESS_TOKEN),{status:400});}}),error=>error.status===503&&!error.message.includes(phone)&&!error.message.includes(settings.WHATSAPP_ACCESS_TOKEN));
for(const path of ['inventory/whatsapp.js','inventory/recipient-otp.js']){const source=await readFile(path,'utf8');assert.ok(!/console\.(?:log|error|warn)/.test(source));}
console.log('PASS OTP: cooldown, daily cap, 10-minute expiry, five-attempt lockout, HMAC, consent activation, safe errors and tenant SQL');
await pool.end();
