import { mongoDomainTransaction, mongoIndexSpecifications } from '../api/mongo.js';
import { randomUUID } from 'node:crypto';
import { readMongoRows } from '../api/mongo-read.js';
import { receiptResultClaimSql, receiptExpiredResultClaimSql, mongoReadyClaim, mongoExpiredClaim, mongoReceiptClaimIndexes } from './receipt-claim-query.js';
import { addInboundQuantities } from '../api/inbound-quantity.js';
import { inventoryPool, transaction } from './db.js';
import { receiveCentralInboundStock } from './wms-operations.js';
import { digest, envelope, validateEnvelope, consumeEvent, retryDelay } from './domain-events.js';
const conflict = () => Object.assign(new Error('Receipt identity, revision or authorization conflict'), {status:409,code:'RECEIPT_CONFLICT'});
const holdReceiptError = error => error.status===409||['EVENT_INVALID','EVENT_CONFLICT'].includes(error.code);
const receiptLeaseMs=120000;
let receiptIndexesVerified=false;
let mongoClaimTurn=0,resultClaimTurn=0;
async function requireReceiptClaimIndexes(){
 if(receiptIndexesVerified)return;
 const installed=await mongoIndexSpecifications('_domain_outbox');
 const valid=mongoReceiptClaimIndexes.every(({keys,options})=>installed.some(index=>index.name===options.name&&
  digest(index.key)===digest(keys)&&index.partialFilterExpression&&digest(index.partialFilterExpression)===digest(options.partialFilterExpression)));
 if(!valid)throw Object.assign(new Error('Receipt claim indexes are missing or differ from the reviewed definitions'),{code:'RECEIPT_CLAIM_INDEX_MISSING',status:503});
 receiptIndexesVerified=true;
}
const tenant = () => {
 const id=process.env.INVENTORY_ALLOWED_TENANT_ID;
 if(!id)throw Object.assign(new Error('Receipt tenant unavailable'),{status:503});
 return id;
};
// Freeze the PO quantity authorization with the command; future PO amendments
// require an explicit reviewed authorization revision, never arbitrary UI limits.
export async function stageReceiptCommand({existing,fields,requestId,fingerprint,inboundNo,poNo,locationCode,lines,source}) {
 const tenantId=tenant();
 if(!['wms_inbound_create_edit','wms_inbound_realtime'].includes(source)||!Array.isArray(lines)||!lines.length||
  !/^[A-Za-z0-9-]{1,120}$/.test(requestId)||!fingerprint||!poNo||!locationCode||
  existing?.central_receipt_status==='blocked'||(existing?.central_request_id&&existing.central_request_id!==requestId))throw conflict();
 const mapping=await inventoryPool().query(`SELECT s.id AS sku_id,s.sku,l.id AS location_id FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.sku=ANY($2::text[]) AND l.code=$3 AND l.location_type IN ('warehouse','store')`,[tenantId,lines.map(l=>l.skuCode),locationCode]);
 if(mapping.rows.length!==lines.length)throw conflict();
 return mongoDomainTransaction(async(db,session)=>{
  const options={session};
  const prior=await db.collection('_domain_outbox').findOne({_id:JSON.stringify([tenantId,requestId])},options);
  if(prior){if(prior.fingerprint!==fingerprint)throw conflict();return db.collection('grn').findOne({id:prior.grn_id},options);}
  const po=await db.collection('purchase_orders').findOne({po_no:poNo},options);
  if(!po||!['Released','Partially Received'].includes(po.status))throw conflict();
  const limits=Object.create(null);
  for(const line of po.line_items||[]){const sku=String(line?.sku_code||line?.skuCode||'').trim(),q=line?.qty??line?.po_qty??line?.poQty;if(!sku)throw conflict();limits[sku]=addInboundQuantities(limits[sku]||0,q);}
  const authorizationDigest=digest({poNo,limits});
  const authorizationKey=JSON.stringify([tenantId,poNo]);
  const auth=await db.collection('_receipt_authorization').findOne({_id:authorizationKey},options);
  if(auth&&auth.digest!==authorizationDigest)throw conflict();
  // A write on the source PO fences concurrent commercial amendments.
  await db.collection('purchase_orders').updateOne({_id:po._id},{$inc:{receipt_authorization_version:1}},options);
  if(!auth)await db.collection('_receipt_authorization').insertOne({_id:authorizationKey,tenant_id:tenantId,po_no:poNo,digest:authorizationDigest,limits},options);
  // Pending GRNs reserve PO capacity immediately; the PostgreSQL consumer
  // independently checks committed ledger totals before applying stock.
  const priorReceipts=await readMongoRows(db.collection('grn'),{po_no:poNo,$or:[{status:'Confirmed'},{central_receipt_status:'pending'}]},{session,projection:{lines:1,status:1,central_receipt_status:1}});
  const legacyReceived=Object.create(null),authorizedReceived=Object.create(null);
  for(const row of priorReceipts)for(const line of row.lines||[]){
   const sku=String(line?.skuCode||line?.sku_code||'').trim();if(!sku)throw conflict();
   const quantity=line.rcvdUOMQty??line.rcvdQty??line.received_qty??0;
   authorizedReceived[sku]=addInboundQuantities(authorizedReceived[sku]||0,quantity);
   if(row.status==='Confirmed'&&row.central_receipt_status!=='committed'&&row.central_receipt_status!=='pending')
    legacyReceived[sku]=addInboundQuantities(legacyReceived[sku]||0,quantity);
  }
  let id=existing?.id;
  if(existing){
   const result=await db.collection('grn').updateOne({id,status:existing.status??null,central_request_id:existing.central_request_id??null,central_receipt_status:existing.central_receipt_status??null,draft_revision:existing.draft_revision??null},{$set:{...fields,draft_revision:Number(existing.draft_revision||0)+1}},options);
   if(result.modifiedCount!==1)throw conflict();
  }else{
   const top=await db.collection('grn').find({},{session,projection:{id:1}}).sort({id:-1}).limit(1).next();
   await db.collection('_counters').updateOne({_id:'grn'},{$max:{seq:Number(top?.id)||0}},{...options,upsert:true});
   const counter=await db.collection('_counters').findOneAndUpdate({_id:'grn'},{$inc:{seq:1}},{...options,returnDocument:'after',includeResultMetadata:false});
   id=counter.seq;await db.collection('grn').insertOne({...fields,id,inbound_no:inboundNo,grn_no:inboundNo,draft_revision:1},options);
  }
  for(const line of lines)if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantity>limits[line.skuCode]-(authorizedReceived[line.skuCode]||0))throw conflict();
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
  const netLimits=new Map(Object.entries(p.authorization.limits).map(([sku,limit])=>[sku,limit-(Object.hasOwn(p.authorization.legacy_received,sku)?p.authorization.legacy_received[sku]:0)]));
  const result=await receiveCentralInboundStock({requestId:p.request_id,inboundNo:p.inbound_no,poNo:p.po_no,locationCode:p.location_code,source:p.source,lines:p.lines.map(l=>({skuCode:l.sku,quantity:l.quantity})),allowedQuantities:netLimits,transactionRunner:fn=>fn(db)});
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
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Receipt bridge batch size must be an integer from 1 to 100'),{status:400,code:'RECEIPT_BATCH_INVALID'});
 const tenantId=tenant();
 await requireReceiptClaimIndexes();
 let commandCount=0,resultCount=0;
 for(let index=0;index<limit;index++){
  const now=new Date(),claimToken=randomUUID();
  const command=await mongoDomainTransaction(async(db,session)=>{
   const collection=db.collection('_domain_outbox');
   const claims=mongoClaimTurn++%2===0?[mongoReadyClaim(tenantId,now),mongoExpiredClaim(tenantId,now)]:[mongoExpiredClaim(tenantId,now),mongoReadyClaim(tenantId,now)];
   for(const claim of claims){
    const row=await collection.findOneAndUpdate(claim.filter,{$set:{status:'processing',claim_token:claimToken,lease_until:new Date(now.getTime()+receiptLeaseMs)},$inc:{attempts:1}},{session,sort:claim.sort,returnDocument:'after',includeResultMetadata:false});
    if(row)return row;
   }
   return null;
  });
  if(!command)break;
  commandCount++;
  try{
   await consumeReceiptCommand(command.event);
   await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').updateOne({_id:command._id,tenant_id:tenantId,status:'processing',claim_token:claimToken},{$set:{status:'done'},$unset:{claim_token:'',lease_until:''}},{session}));
  }catch(error){
   const held=holdReceiptError(error);
   await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').updateOne({_id:command._id,tenant_id:tenantId,status:'processing',claim_token:claimToken},{$set:{status:held?'held':command.attempts>=8?'dead':'retry',available_at:new Date(Date.now()+retryDelay(command.attempts)),reason:held?'CONFLICT':'DEPENDENCY_FAILURE'},$unset:{claim_token:'',lease_until:''}},{session}));
  }
 }
 for(let index=0;index<limit;index++){
  const claimToken=randomUUID();
  const claims=resultClaimTurn++%2===0?[receiptResultClaimSql,receiptExpiredResultClaimSql]:[receiptExpiredResultClaimSql,receiptResultClaimSql];
  let row;
  for(const sql of claims){row=(await inventoryPool().query(sql,[tenantId,claimToken])).rows[0];if(row)break;}
  if(!row)break;
  resultCount++;
  try{await projectReceiptResult(row.envelope);await inventoryPool().query("UPDATE ci_domain_outbox SET status='done',claim_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND event_id=$2 AND status='processing' AND claim_token=$3",[tenantId,row.event_id,claimToken]);}
  catch(error){await inventoryPool().query("UPDATE ci_domain_outbox SET status=CASE WHEN $3='held' THEN 'held' WHEN attempts>=8 THEN 'dead' ELSE 'retry' END,available_at=now()+($4::text||' milliseconds')::interval,claim_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND event_id=$2 AND status='processing' AND claim_token=$5",[tenantId,row.event_id,holdReceiptError(error)?'held':'retry',retryDelay(Number(row.attempts||0)),claimToken]);}
 }
 // A crash on the last permitted attempt must not leave a permanent lease.
 for(let index=0;index<limit;index++){
  const expired=await mongoDomainTransaction((db,session)=>db.collection('_domain_outbox').findOneAndUpdate({tenant_id:tenantId,status:'processing',attempts:{$gte:8},lease_until:{$lte:new Date()}},{$set:{status:'dead',reason:'LEASE_EXPIRED'},$unset:{claim_token:'',lease_until:''}},{session,sort:{lease_until:1,_id:1},returnDocument:'after',includeResultMetadata:false}));
  if(!expired)break;
 }
 await inventoryPool().query(`WITH expired AS (
  SELECT event_id FROM ci_domain_outbox WHERE tenant_id=$1 AND status='processing' AND attempts>=8 AND lease_until<=now()
  ORDER BY lease_until,event_id FOR UPDATE SKIP LOCKED LIMIT $2
 ) UPDATE ci_domain_outbox AS o SET status='dead',claim_token=NULL,lease_until=NULL
  FROM expired WHERE o.tenant_id=$1 AND o.event_id=expired.event_id`,[tenantId,limit]);
 return {commands:commandCount,results:resultCount};
}
