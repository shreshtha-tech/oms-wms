import { createHash, randomUUID } from 'node:crypto';
const types = new Set(['provider.shopify.order.observed.v1','provider.woocommerce.order.observed.v1','provider.amazon.order.observed.v1','provider.shopify.order.recovered.v1','report.meesho.order.observed.v1','order.intake.recorded.v1','ledger.balance.changed.v1','channel.stock.publish.requested.v1','channel.stock.observed.v1','order.alert.queued.v1','order.alert.delivery-observed.v1','return.case.observed.v1','inbound.receipt.requested.v1','inbound.receipt.result.v1']);
function canonical(value) {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function envelope({tenantId,type,key,sequence=1,payload,id=randomUUID(),correlationId=randomUUID(),causationId=null,store='mongodb'}) {
 const at=new Date().toISOString();
 return {event_id:id,event_type:type,schema_version:1,tenant_id:tenantId,aggregate:{type:type.split('.')[0],key,sequence},idempotency_key:digest([tenantId,type,key,sequence]),occurred_at:at,recorded_at:at,source:{store,producer:'receipt-bridge',source_revision:sequence},payload_digest:digest(payload),correlation_id:correlationId,causation_id:causationId,payload};
}
export function validateEnvelope(event,tenantId) {
 if(!event||event.tenant_id!==tenantId||!types.has(event.event_type)||event.schema_version!==1||!/^[a-f0-9-]{36}$/i.test(event.event_id||'')||!Array.isArray(event.aggregate?.key)||!event.aggregate.key.length||event.aggregate.key.some(k=>typeof k!=='string'||!k)||!Number.isSafeInteger(event.aggregate.sequence)||event.aggregate.sequence<1||event.payload_digest!==digest(event.payload))throw Object.assign(new Error('Domain event validation failed'),{code:'EVENT_INVALID'});
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
