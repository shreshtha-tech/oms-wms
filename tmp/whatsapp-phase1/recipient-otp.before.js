import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';
import { providerFetch } from './connection-security.js';

const phonePattern=/^\+[1-9]\d{7,14}$/;
const templatePattern=/^[a-z0-9_]{1,512}$/;
const codePattern=/^\d{6}$/;
const failure=(status,message)=>Object.assign(new Error(message),{status});
const digest=(recipientId,challengeId,code,secret)=>createHmac('sha256',secret).update(`${recipientId}:${challengeId}:${code}`).digest('hex');

export function otpConfigured(settings=process.env){
 return /^v\d+\.\d+$/.test(settings.WHATSAPP_GRAPH_VERSION||'')&&/^\d+$/.test(settings.WHATSAPP_PHONE_NUMBER_ID||'')&&Boolean(settings.WHATSAPP_ACCESS_TOKEN&&settings.WHATSAPP_APP_SECRET)&&templatePattern.test(settings.WHATSAPP_OTP_TEMPLATE||'');
}

export function otpTemplatePayload(mobile,code,settings=process.env){
 if(!phonePattern.test(mobile)||!codePattern.test(code)||!templatePattern.test(settings.WHATSAPP_OTP_TEMPLATE||''))throw failure(400,'Invalid recipient, code, or approved authentication template');
 return {messaging_product:'whatsapp',recipient_type:'individual',to:mobile.slice(1),type:'template',template:{name:settings.WHATSAPP_OTP_TEMPLATE,language:{code:settings.WHATSAPP_OTP_TEMPLATE_LANGUAGE||'en_US'},components:[
  {type:'body',parameters:[{type:'text',text:code}]},
  {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}]}
 ]}};
}

export async function requestRecipientOtp({tenantId,recipientId,pool,fetcher=providerFetch,settings=process.env}){
 if(!otpConfigured(settings))throw failure(409,'Configure the Meta sender and approved WhatsApp authentication template first');
 const code=String(randomInt(0,1_000_000)).padStart(6,'0'),challengeId=randomUUID();
 const recipient=await transaction(async db=>{
  const row=(await db.query('SELECT id,mobile_e164,verified_at FROM ci_alert_recipient WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,recipientId])).rows[0];
  if(!row)throw failure(404,'Team member not found');
  if(row.verified_at)throw failure(409,'This number is already verified');
  const prior=(await db.query('SELECT requested_at,window_start,window_count FROM ci_recipient_verification WHERE tenant_id=$1 AND recipient_id=$2 FOR UPDATE',[tenantId,recipientId])).rows[0];
  if(prior&&Date.now()-new Date(prior.requested_at).getTime()<60_000)throw failure(429,'Wait one minute before requesting another code');
  const inWindow=prior&&Date.now()-new Date(prior.window_start).getTime()<86_400_000;
  if(inWindow&&prior.window_count>=10)throw failure(429,'Daily verification-code limit reached');
  await db.query(`INSERT INTO ci_recipient_verification(recipient_id,tenant_id,challenge_id,code_hash,expires_at,status,attempts,requested_at,window_start,window_count,provider_message_id)
   VALUES($1,$2,$3,$4,now()+interval '10 minutes','sending',0,now(),now(),1,NULL)
   ON CONFLICT(recipient_id) DO UPDATE SET challenge_id=EXCLUDED.challenge_id,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,status='sending',attempts=0,requested_at=now(),window_start=CASE WHEN ci_recipient_verification.window_start<now()-interval '24 hours' THEN now() ELSE ci_recipient_verification.window_start END,window_count=CASE WHEN ci_recipient_verification.window_start<now()-interval '24 hours' THEN 1 ELSE ci_recipient_verification.window_count+1 END,provider_message_id=NULL`,
   [recipientId,tenantId,challengeId,digest(recipientId,challengeId,code,settings.WHATSAPP_APP_SECRET)]);
  return row;
 });
 const url=`https://graph.facebook.com/${settings.WHATSAPP_GRAPH_VERSION}/${settings.WHATSAPP_PHONE_NUMBER_ID}/messages`;
 try{
  const response=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${settings.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(otpTemplatePayload(recipient.mobile_e164,code,settings))});
  if(!response.ok)throw failure(502,`Meta rejected the verification template (HTTP ${response.status})`);
  const messageId=(await response.json())?.messages?.[0]?.id;
  if(typeof messageId!=='string'||!messageId.startsWith('wamid.'))throw failure(502,'Meta did not confirm acceptance of the verification message');
  const updated=await pool.query("UPDATE ci_recipient_verification SET status='sent',provider_message_id=$4 WHERE tenant_id=$1 AND recipient_id=$2 AND challenge_id=$3 AND status='sending' RETURNING expires_at",[tenantId,recipientId,challengeId,messageId]);
  if(!updated.rowCount)throw failure(409,'A newer verification request replaced this code');
  return {sent:true,expiresAt:updated.rows[0].expires_at};
 }catch(error){
  await pool.query("UPDATE ci_recipient_verification SET status='failed' WHERE tenant_id=$1 AND recipient_id=$2 AND challenge_id=$3 AND status='sending'",[tenantId,recipientId,challengeId]).catch(()=>{});
  throw error.status?error:failure(503,'Could not confirm that Meta accepted the verification message');
 }
}

export async function verifyRecipientOtp({tenantId,recipientId,code,settings=process.env}){
 if(!codePattern.test(code||''))throw failure(400,'Enter the six-digit verification code');
 if(!settings.WHATSAPP_APP_SECRET)throw failure(409,'WhatsApp verification is not configured');
 const result=await transaction(async db=>{
  const recipient=(await db.query('SELECT id,verified_at FROM ci_alert_recipient WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,recipientId])).rows[0];
  if(!recipient)throw failure(404,'Team member not found');
  if(recipient.verified_at)return {verified:true,alreadyVerified:true};
  const challenge=(await db.query('SELECT challenge_id,code_hash,expires_at,status,attempts FROM ci_recipient_verification WHERE tenant_id=$1 AND recipient_id=$2 FOR UPDATE',[tenantId,recipientId])).rows[0];
  if(!challenge||challenge.status!=='sent'||new Date(challenge.expires_at).getTime()<=Date.now())throw failure(409,'Code expired or not sent; request a new one');
  if(challenge.attempts>=5)throw failure(429,'Too many incorrect codes; request a new one');
  const expected=Buffer.from(challenge.code_hash,'hex'),actual=Buffer.from(digest(recipientId,challenge.challenge_id,code,settings.WHATSAPP_APP_SECRET),'hex');
  if(!timingSafeEqual(expected,actual)){
   await db.query("UPDATE ci_recipient_verification SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'locked' ELSE status END WHERE tenant_id=$1 AND recipient_id=$2",[tenantId,recipientId]);
   return {verified:false,incorrect:true,locked:challenge.attempts+1>=5};
  }
  await db.query('UPDATE ci_alert_recipient SET verified_at=now(),active=(consented_at IS NOT NULL) WHERE tenant_id=$1 AND id=$2',[tenantId,recipientId]);
  await db.query("UPDATE ci_recipient_verification SET status='verified',code_hash='' WHERE tenant_id=$1 AND recipient_id=$2",[tenantId,recipientId]);
  return {verified:true,alreadyVerified:false};
 });
 if(result.incorrect)throw failure(result.locked?429:400,result.locked?'Too many incorrect codes; request a new one':'Incorrect verification code');
 return result;
}
