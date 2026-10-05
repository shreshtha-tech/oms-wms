import { inventoryPool } from './db.js';
import { redact } from './connection-security.js';
import { openCredential } from './credentials.js';

function requireBoundedDiagnostic(value){
 const pending=[{value,depth:0}],seen=new Set();let nodes=0,characters=0;
 while(pending.length){
  const {value:item,depth}=pending.pop();
  if(++nodes>1000||depth>20)throw new Error('Diagnostic budget exceeded');
  if(typeof item==='string'){characters+=item.length;if(characters>64000)throw new Error('Diagnostic budget exceeded');continue;}
  if(['bigint','symbol','function'].includes(typeof item))throw new Error('Unsupported diagnostic type');
  if(item&&typeof item==='object'){
   if(seen.has(item)||ArrayBuffer.isView(item)||item instanceof ArrayBuffer)throw new Error('Unsupported diagnostic data');
   seen.add(item);
   if(!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw new Error('Unsupported diagnostic object');
   const keys=Object.keys(item);
   if(keys.length+nodes+pending.length>1000)throw new Error('Diagnostic budget exceeded');
   for(const key of keys){characters+=key.length;if(characters>64000)throw new Error('Diagnostic budget exceeded');pending.push({value:item[key],depth:depth+1});}
  }
 }
}

export async function safeAccountDiagnostic(tenantId,accountId,diagnostic,db){
 try{
 requireBoundedDiagnostic(diagnostic);
 db??=inventoryPool();
 const row=(await db.query('SELECT encrypted_credentials,credential_iv,credential_tag FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenantId,accountId])).rows[0];
 let secrets=[];
 if(row?.encrypted_credentials){
  try{secrets=Object.values(openCredential(row));}
  catch{
   // Without the decryption key we cannot remove account-specific secrets
   // from free-form provider errors. Discard those errors, while allowing
   // durable retry/dead-letter handling to record a safe failure category.
   return {message:'Diagnostic withheld: provider credentials could not be decrypted',code:'CREDENTIAL_DIAGNOSTIC_UNAVAILABLE'};
  }
 }
 const safe=redact(diagnostic,secrets);
 // Prove serialization here, inside the non-authoritative safety boundary.
 if((JSON.stringify(safe)||'').length>64000)throw new Error('Diagnostic budget exceeded');
 return safe;
 }catch{
  // Diagnostics are not authority for task recovery. Never propagate lookup,
  // getters or recursive redaction failures, and never echo the unsafe input.
  return {message:'Diagnostic withheld: diagnostic processing unavailable',code:'DIAGNOSTIC_UNAVAILABLE'};
 }
}

export function safeProviderStatus(error){
 try{const value=error?.providerStatus;if(Number.isInteger(value)&&value>=100&&value<=599)return value;}catch{}
 return 0;
}

export async function safeAccountFailure(tenantId,accountId,error,db){
 let message='Diagnostic withheld: unexpected failure value',providerStatus=0;
 try{
  const value=error?.message;
  // Avoid invoking arbitrary conversion hooks on malformed thrown objects.
  if(typeof value==='string')message=value.slice(0,500);
 }catch{}
 providerStatus=safeProviderStatus(error);
 const safe=await safeAccountDiagnostic(tenantId,accountId,{message},db);
 return {...safe,providerStatus};
}

export async function logSyncAttempt({tenantId,accountId,direction,operation,skuCount=0,status='success',diagnostic={}},db){
 if(!accountId)return;
 db??=inventoryPool();
 const safe=await safeAccountDiagnostic(tenantId,accountId,diagnostic,db);
 await db.query('INSERT INTO ci_sync_attempt(tenant_id,account_id,direction,operation,sku_count,status,diagnostic,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())',[tenantId,accountId,direction,operation,skuCount,status,JSON.stringify(safe)]);
 // A task outcome is not a credential probe. Internal ingress can succeed
 // without calling the provider, and mapping/business failures say nothing
 // about authorization. Keep verification owned by explicit provider probes.
 if(['inbound','outbound'].includes(direction)&&status==='success')await db.query("UPDATE ci_channel_account SET settings=settings||jsonb_build_object('lastSyncAt',now()),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,accountId]);
}

// Use only after the authoritative operation/failure state is durable.
// Callers requiring a transactional business audit must use logSyncAttempt.
export async function tryLogSyncAttempt(attempt){
 try{await logSyncAttempt(attempt);return true;}catch{return false;}
}
