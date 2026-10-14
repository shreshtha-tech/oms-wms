import { createHash, randomUUID } from 'node:crypto';
const types = new Set(['inbound.receipt.requested.v1','inbound.receipt.result.v1']);
function canonical(value) {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const sha = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value,required) => value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===required.length && required.every(key=>Object.hasOwn(value,key));
const positive = value => Number.isSafeInteger(value) && value>0;
const quantityMap = value => value && typeof value==='object' && !Array.isArray(value) &&
 Object.keys(value).length<=1200 && Object.entries(value).every(([sku,quantity])=>sku.length>0&&sku.length<=120&&Number.isSafeInteger(quantity)&&quantity>=0);
function validPayload(event) {
 const p=event.payload;
 if(event.event_type==='inbound.receipt.requested.v1') {
  if(!keys(p,['grn_id','request_id','inbound_no','po_no','location_id','location_code','draft_revision','payload_digest','source','authorization','lines']) ||
   !keys(p.authorization,['digest','limits','legacy_received']) ||
   !quantityMap(p.authorization.limits)||!quantityMap(p.authorization.legacy_received)||
   Object.entries(p.authorization.legacy_received).some(([sku,quantity])=>!Object.hasOwn(p.authorization.limits,sku)||quantity>p.authorization.limits[sku])||
   !Array.isArray(p.lines) || !p.lines.length || p.lines.length>1200 ||
   !uuid(p.location_id) || !sha(p.payload_digest) || !sha(p.authorization.digest) || !positive(p.draft_revision) ||
   !['wms_inbound_create_edit','wms_inbound_realtime'].includes(p.source) ||
   ![p.grn_id,p.request_id,p.inbound_no,p.po_no,p.location_code].every(value=>typeof value==='string'&&value.length>0&&value.length<=120))return false;
  const seen=new Set();
  return p.lines.every(line=>keys(line,['sku','master_sku_id','quantity','max_receivable_quantity'])&&
   typeof line.sku==='string'&&line.sku.length>0&&line.sku.length<=120&&!seen.has(line.sku)&&seen.add(line.sku)&&
   uuid(line.master_sku_id)&&positive(line.quantity)&&positive(line.max_receivable_quantity)&&
   Object.hasOwn(p.authorization.limits,line.sku)&&p.authorization.limits[line.sku]===line.max_receivable_quantity&&
   line.quantity<=line.max_receivable_quantity-(Object.hasOwn(p.authorization.legacy_received,line.sku)?p.authorization.legacy_received[line.sku]:0));
 }
 if(event.event_type==='inbound.receipt.result.v1')return keys(p,['grn_id','request_id','payload_digest','event_ids','result','reason_code'])&&
  [p.grn_id,p.request_id,p.reason_code].every(value=>typeof value==='string'&&value.length>0&&value.length<=120)&&
  sha(p.payload_digest)&&Array.isArray(p.event_ids)&&p.event_ids.length>0&&p.event_ids.length<=1200&&p.event_ids.every(uuid)&&p.result==='committed';
 return false;
}
export function envelope({tenantId,type,key,sequence=1,payload,id=randomUUID(),correlationId=randomUUID(),causationId=null,store='mongodb'}) {
 const at=new Date().toISOString();
 return {event_id:id,event_type:type,schema_version:1,tenant_id:tenantId,aggregate:{type:'grn',key,sequence},idempotency_key:digest([tenantId,type,key,sequence]),occurred_at:at,recorded_at:at,source:{store,producer:'receipt-bridge',source_revision:sequence},payload_digest:digest(payload),correlation_id:correlationId,causation_id:causationId,payload};
}
export function validateEnvelope(event,tenantId) {
 if(!keys(event,['event_id','event_type','schema_version','tenant_id','aggregate','idempotency_key','occurred_at','recorded_at','source','payload_digest','correlation_id','causation_id','payload'])||
  event.tenant_id!==tenantId||!types.has(event.event_type)||event.schema_version!==1||!uuid(event.event_id)||!uuid(event.correlation_id)||
  !(event.causation_id===null||uuid(event.causation_id))||!keys(event.aggregate,['type','key','sequence'])||event.aggregate.type!=='grn'||
  !Array.isArray(event.aggregate.key)||event.aggregate.key.length!==3||event.aggregate.key.some(k=>typeof k!=='string'||!k)||
  event.aggregate.key[1]!==event.payload?.grn_id||event.aggregate.key[2]!==event.payload?.request_id||
  !positive(event.aggregate.sequence)||event.aggregate.key[0]!==tenantId||!keys(event.source,['store','producer','source_revision'])||
  !['mongodb','postgresql'].includes(event.source.store)||event.source.producer!=='receipt-bridge'||!positive(event.source.source_revision)||
  !sha(event.payload_digest)||!validPayload(event)||event.payload_digest!==digest(event.payload)||event.idempotency_key!==digest([tenantId,event.event_type,event.aggregate.key,event.aggregate.sequence]))throw Object.assign(new Error('Domain event validation failed'),{code:'EVENT_INVALID'});
 return event;
}
// Caller transaction owns both receipt and all effects. Failed effect rolls both back.
export async function consumeEvent(db,event,consumer,tenantId,effect) {
 validateEnvelope(event,tenantId);
 const key=JSON.stringify(event.aggregate.key), hash=digest(event);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenantId,consumer,key])]);
 const prior=(await db.query('SELECT digest,result FROM ci_event_receipt WHERE tenant_id=$1 AND consumer=$2 AND event_id=$3',[tenantId,consumer,event.event_id])).rows[0];
 if(prior){if(prior.digest!==hash)throw Object.assign(new Error('Event replay content conflict'),{code:'EVENT_CONFLICT'});return {...prior.result,duplicate:true};}
 await db.query('INSERT INTO ci_event_checkpoint(tenant_id,consumer,aggregate_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenantId,consumer,key]);
 const checkpoint=(await db.query('SELECT sequence FROM ci_event_checkpoint WHERE tenant_id=$1 AND consumer=$2 AND aggregate_key=$3 FOR UPDATE',[tenantId,consumer,key])).rows[0];
 if(Number(checkpoint.sequence)+1!==event.aggregate.sequence)throw Object.assign(new Error('Aggregate sequence gap or conflict'),{code:'EVENT_SEQUENCE'});
 const result=await effect(db,event);
 await db.query('INSERT INTO ci_event_receipt(tenant_id,consumer,event_id,digest,aggregate_key,sequence,result) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,consumer,event.event_id,hash,key,event.aggregate.sequence,result]);
 await db.query('UPDATE ci_event_checkpoint SET sequence=$4 WHERE tenant_id=$1 AND consumer=$2 AND aggregate_key=$3',[tenantId,consumer,key,event.aggregate.sequence]);
 return result;
}
export function retryDelay(attempt,random=Math.random){return Math.round(Math.min(3600000,5000*2**attempt)*(0.5+0.5*random()));}
