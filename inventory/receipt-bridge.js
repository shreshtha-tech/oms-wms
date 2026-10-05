import { mongoDomainTransaction } from '../api/mongo.js';
import { inventoryPool, transaction } from './db.js';
import { receiveCentralInboundStock } from './wms-operations.js';
import { digest, envelope, validateEnvelope, consumeEvent, retryDelay } from './domain-events.js';
const conflict = () => Object.assign(new Error('Receipt identity, revision or authorization conflict'), {status:409,code:'RECEIPT_CONFLICT'});
const tenant = () => {
 const id=process.env.INVENTORY_ALLOWED_TENANT_ID;
 if(!id)throw Object.assign(new Error('Receipt tenant unavailable'),{status:503});
 return id;
};
// Freeze the PO quantity authorization with the command; future PO amendments
// require an explicit reviewed authorization revision, never arbitrary UI limits.
export async function stageReceiptCommand({existing,fields,requestId,fingerprint,inboundNo,poNo,locationCode,lines,source}) {
 const tenantId=tenant();
 const mapping=await inventoryPool().query(`SELECT s.id AS sku_id,s.sku,l.id AS location_id FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.sku=ANY($2::text[]) AND l.code=$3 AND l.location_type IN ('warehouse','store')`,[tenantId,lines.map(l=>l.skuCode),locationCode]);
 if(mapping.rows.length!==lines.length)throw conflict();
 return mongoDomainTransaction(async(db,session)=>{
  const options={session};
  const prior=await db.collection('_domain_outbox').findOne({_id:JSON.stringify([tenantId,requestId])},options);
  if(prior){if(prior.fingerprint!==fingerprint)throw conflict();return db.collection('grn').findOne({id:prior.grn_id},options);}
  const po=await db.collection('purchase_orders').findOne({po_no:poNo},options);
  if(!po)throw conflict();
  const limits={};
  for(const line of po.line_items||[]){const sku=String(line.sku_code||line.skuCode||'').trim(),q=Number(line.qty??line.po_qty??line.poQty);if(!sku||!Number.isSafeInteger(q)||q<0)throw conflict();limits[sku]=(limits[sku]||0)+q;}
  const authorizationDigest=digest({poNo,limits});
  const authorizationKey=JSON.stringify([tenantId,poNo]);
  const auth=await db.collection('_receipt_authorization').findOne({_id:authorizationKey},options);
  if(auth&&auth.digest!==authorizationDigest)throw conflict();
  // A write on the source PO fences concurrent commercial amendments.
  await db.collection('purchase_orders').updateOne({_id:po._id},{$inc:{receipt_authorization_version:1}},options);
  if(!auth)await db.collection('_receipt_authorization').insertOne({_id:authorizationKey,tenant_id:tenantId,po_no:poNo,digest:authorizationDigest,limits},options);
  const historic=await db.collection('grn').find({po_no:poNo,status:'Confirmed'},{session,projection:{lines:1}}).toArray();
  const legacyReceived={};
  for(const row of historic)for(const line of row.lines||[]){const sku=String(line.skuCode||line.sku_code||'').trim();legacyReceived[sku]=(legacyReceived[sku]||0)+Number(line.rcvdUOMQty??line.rcvdQty??line.received_qty??0);}
  let id=existing?.id;
  if(existing){
   const result=await db.collection('grn').updateOne({id,status:existing.status??null,central_request_id:existing.central_request_id??null,central_receipt_status:existing.central_receipt_status??null,draft_revision:existing.draft_revision??null},{$set:{...fields,draft_revision:Number(existing.draft_revision||0)+1}},options);
   if(result.modifiedCount!==1)throw conflict();
  }else{
   const top=await db.collection('grn').find({},{session,projection:{id:1}}).sort({id:-1}).limit(1).next();
   await db.collection('_counters').updateOne({_id:'grn'},{$max:{seq:Number(top?.id)||0}},{...options,upsert:true});
   const counter=await db.collection('_counters').findOneAndUpdate({_id:'grn'},{$inc:{seq:1}},{...options,returnDocument:'after'});
   id=counter.seq;await db.collection('grn').insertOne({...fields,id,inbound_no:inboundNo,grn_no:inboundNo,draft_revision:1},options);
  }
  for(const line of lines)if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantity>limits[line.skuCode]-(legacyReceived[line.skuCode]||0))throw conflict();
  const payload={grn_id:String(id),request_id:requestId,inbound_no:inboundNo,po_no:poNo,location_id:mapping.rows[0].location_id,location_code:locationCode,draft_revision:Number(existing?.draft_revision||0)+1,payload_digest:fingerprint,source,authorization:{digest:authorizationDigest,limits,legacy_received:legacyReceived},lines:lines.map(l=>({sku:l.skuCode,master_sku_id:mapping.rows.find(m=>m.sku===l.skuCode).sku_id,quantity:l.quantity,max_receivable_quantity:limits[l.skuCode]}))};
  const event=envelope({tenantId,type:'inbound.receipt.requested.v1',key:[tenantId,String(id),requestId],payload});
  await db.collection('_domain_outbox').insertOne({_id:JSON.stringify([tenantId,requestId]),tenant_id:tenantId,grn_id:id,fingerprint,event,status:'pending',attempts:0,available_at:new Date()},options);
  return db.collection('grn').findOne({id},options);
 });
}
export async function consumeReceiptCommand(event) {
 const tenantId=tenant();validateEnvelope(event,tenantId);
 if(event.event_type!=='inbound.receipt.requested.v1')throw conflict();
 const p=event.payload;
 if(!p||!p.authorization||digest({poNo:p.po_no,limits:p.authorization.limits})!==p.authorization.digest||!Array.isArray(p.lines)||!p.lines.length)throw conflict();
 return transaction(db=>consumeEvent(db,event,'receipt-ledger',tenantId,async()=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenantId,p.po_no])]);
  await db.query('INSERT INTO ci_receipt_authorization(tenant_id,po_no,digest,limits) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenantId,p.po_no,p.authorization.digest,p.authorization.limits]);
  const auth=(await db.query('SELECT digest FROM ci_receipt_authorization WHERE tenant_id=$1 AND po_no=$2',[tenantId,p.po_no])).rows[0];
  if(auth.digest!==p.authorization.digest)throw conflict();
  const exact=await db.query(`SELECT s.id AS sku_id,s.sku,l.id AS location_id FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.sku=ANY($2::text[]) AND l.code=$3`,[tenantId,p.lines.map(l=>l.sku),p.location_code]);
  if(exact.rows.length!==p.lines.length||p.lines.some(l=>!exact.rows.some(m=>m.sku===l.sku&&m.sku_id===l.master_sku_id&&m.location_id===p.location_id)))throw conflict();
  const result=await receiveCentralInboundStock({requestId:p.request_id,inboundNo:p.inbound_no,poNo:p.po_no,locationCode:p.location_code,source:p.source,lines:p.lines.map(l=>({skuCode:l.sku,quantity:l.quantity})),allowedQuantities:new Map(Object.entries(p.authorization.limits)),transactionRunner:fn=>fn(db)});
  const response=envelope({tenantId,type:'inbound.receipt.result.v1',key:event.aggregate.key,payload:{grn_id:p.grn_id,request_id:p.request_id,payload_digest:p.payload_digest,event_ids:result.eventIds,result:'committed',reason_code:'COMMITTED'},store:'postgresql',correlationId:event.correlation_id,causationId:event.event_id});
  await db.query('INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope) VALUES($1,$2,$3)',[response.event_id,tenantId,response]);
  return {eventIds:result.eventIds,resultEventId:response.event_id};
 }));
}
export async function projectReceiptResult(event) {
 const tenantId=tenant();validateEnvelope(event,tenantId);
 if(event.event_type!=='inbound.receipt.result.v1')throw conflict();
 return mongoDomainTransaction(async(db,session)=>{
  const options={session},p=event.payload,key=JSON.stringify([tenantId,'receipt-result',event.event_id]);
  const prior=await db.collection('_domain_inbox').findOne({_id:key},options);
  if(prior){if(prior.digest!==digest(event))throw conflict();return {duplicate:true};}
  const command=await db.collection('_domain_outbox').findOne({_id:JSON.stringify([tenantId,p.request_id])},options);
  if(!command||command.event.event_id!==event.causation_id||command.fingerprint!==p.payload_digest||String(command.grn_id)!==p.grn_id)throw conflict();
  const result=await db.collection('grn').updateOne({id:command.grn_id,central_request_id:p.request_id,central_receipt_fingerprint:p.payload_digest,central_receipt_status:'pending'},{$set:{status:'Confirmed',status_code:4,central_receipt_status:'committed',central_receipt_event_ids:p.event_ids,status_changed_date:new Date().toISOString()}},options);
  if(result.modifiedCount!==1)throw conflict();
  await db.collection('_domain_inbox').insertOne({_id:key,tenant_id:tenantId,digest:digest(event)},options);
  return {duplicate:false};
 });
}
export async function runReceiptBridgeBatch(limit=10) {
 const tenantId=tenant();
 const commands=await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').find({tenant_id:tenantId,status:{$in:['pending','retry']},available_at:{$lte:new Date()}},{session}).sort({_id:1}).limit(limit).toArray());
 for(const command of commands){
  try{
   await consumeReceiptCommand(command.event);
   await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').updateOne({_id:command._id},{$set:{status:'done'}},{session}));
  }catch(error){
   const attempts=command.attempts+1,held=Boolean(error.status===409||['EVENT_INVALID','EVENT_CONFLICT','EVENT_SEQUENCE'].includes(error.code));
   await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').updateOne({_id:command._id,status:{$ne:'done'}},{$set:{status:held?'held':attempts>=8?'dead':'retry',attempts,available_at:new Date(Date.now()+retryDelay(attempts)),reason:held?'CONFLICT':'DEPENDENCY_FAILURE'}},{session}));
  }
 }
 const results=await inventoryPool().query("SELECT event_id,envelope FROM ci_domain_outbox WHERE tenant_id=$1 AND status IN ('pending','retry') AND available_at<=now() ORDER BY created_at LIMIT $2",[tenantId,limit]);
 for(const row of results.rows){
  try{await projectReceiptResult(row.envelope);await inventoryPool().query("UPDATE ci_domain_outbox SET status='done' WHERE tenant_id=$1 AND event_id=$2",[tenantId,row.event_id]);}
  catch(error){await inventoryPool().query("UPDATE ci_domain_outbox SET status=$3,attempts=attempts+1,available_at=now()+($4::text||' milliseconds')::interval WHERE tenant_id=$1 AND event_id=$2",[tenantId,row.event_id,error.status===409?'held':'retry',retryDelay(1)]);}
 }
 return {commands:commands.length,results:results.rowCount};
}
