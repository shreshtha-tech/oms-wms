import { transaction, inventoryPool } from './db.js';
import { applyInventoryEventInTransaction } from './ledger.js';

export async function returnOptions(tenantId,returnId){
 const row=(await inventoryPool().query('SELECT * FROM ci_return_case WHERE tenant_id=$1 AND id=$2',[tenantId,returnId])).rows[0];
 if(!row)throw Object.assign(new Error('Return not found'),{status:404});
 const {rows}=await inventoryPool().query(`SELECT m.master_sku_id,s.sku,sum(l.quantity)::integer AS ordered_quantity,m.pack_size
 FROM ci_unified_order o JOIN ci_unified_order_line l ON l.tenant_id=o.tenant_id AND l.order_id=o.id
 JOIN (SELECT DISTINCT tenant_id,account_id,master_sku_id,external_sku,pack_size FROM ci_channel_mapping) m ON m.tenant_id=o.tenant_id AND m.account_id=o.account_id AND m.external_sku=l.seller_sku
 JOIN ci_master_sku s ON s.tenant_id=m.tenant_id AND s.id=m.master_sku_id
 WHERE o.tenant_id=$1 AND o.account_id=$2 AND o.external_order_id=$3
 GROUP BY m.master_sku_id,s.sku,m.pack_size`,[tenantId,row.account_id,row.external_order_id]);
 const locations=(await inventoryPool().query("SELECT id,code FROM ci_location WHERE tenant_id=$1 AND location_type IN ('warehouse','store') ORDER BY code",[tenantId])).rows;
 return {items:rows,locations};
}

export async function approveReturnReceipt({tenantId,returnId,requestId,masterSkuId,locationId,quantity}){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId))||!/^[0-9a-f-]{36}$/i.test(String(masterSkuId))||!/^[0-9a-f-]{36}$/i.test(String(locationId))||!Number.isSafeInteger(quantity)||quantity<=0)throw Object.assign(new Error('Valid request, SKU, location and positive quantity required'),{status:400});
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`return-receipt:${tenantId}:${requestId.toLowerCase()}`]);
  const prior=(await db.query('SELECT * FROM ci_return_receipt WHERE tenant_id=$1 AND request_id=$2',[tenantId,requestId])).rows[0];
  if(prior){if(prior.return_id!==returnId||prior.master_sku_id!==masterSkuId||prior.location_id!==locationId||Number(prior.quantity)!==quantity)throw Object.assign(new Error('Receipt key replayed with changed content'),{status:409});return {duplicate:true,receiptId:prior.id,eventId:prior.event_id};}
  const claim=(await db.query('SELECT * FROM ci_return_case WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,returnId])).rows[0];
  if(!claim)throw Object.assign(new Error('Return not found'),{status:404});
  if(!claim.external_order_id)throw Object.assign(new Error('Return lacks a verified source order'),{status:409});
  const order=(await db.query('SELECT * FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3 FOR UPDATE',[tenantId,claim.account_id,claim.external_order_id])).rows[0];
  if(!order)throw Object.assign(new Error('Original order is not in the unified ledger'),{status:409});
  const mappings=(await db.query(`SELECT DISTINCT m.pack_size FROM ci_channel_mapping m JOIN ci_unified_order_line l ON l.tenant_id=m.tenant_id AND l.seller_sku=m.external_sku AND l.order_id=$4
   WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.master_sku_id=$3`,[tenantId,claim.account_id,masterSkuId,order.id])).rows;
  if(mappings.length!==1)throw Object.assign(new Error('Return SKU is not uniquely mapped from the original order'),{status:409});
  const packSize=Number(mappings[0].pack_size);
  const ordered=(await db.query(`SELECT coalesce(sum(l.quantity),0)::bigint AS qty FROM ci_unified_order_line l JOIN (SELECT DISTINCT tenant_id,account_id,master_sku_id,external_sku FROM ci_channel_mapping) m ON m.tenant_id=l.tenant_id AND m.account_id=$3 AND m.external_sku=l.seller_sku AND m.master_sku_id=$4
   WHERE l.tenant_id=$1 AND l.order_id=$2`,[tenantId,order.id,claim.account_id,masterSkuId])).rows[0];
  const priorReceived=(await db.query(`SELECT coalesce(sum(rr.quantity),0)::bigint AS qty FROM ci_return_receipt rr JOIN ci_return_case rc ON rc.id=rr.return_id
   JOIN ci_master_sku s ON s.tenant_id=rr.tenant_id AND s.id=rr.master_sku_id
   WHERE rr.tenant_id=$1 AND rc.account_id=$2 AND rc.external_order_id=$3 AND coalesce(s.merged_into_id,s.id)=$4`,[tenantId,claim.account_id,claim.external_order_id,masterSkuId])).rows[0];
  const consumed=(await db.query("SELECT coalesce(sum(r.consumed_qty),0)::bigint AS qty FROM ci_reservation r JOIN ci_master_sku s ON s.tenant_id=r.tenant_id AND s.id=r.master_sku_id WHERE r.tenant_id=$1 AND r.source=$2 AND r.external_order_id=$3 AND coalesce(s.merged_into_id,s.id)=$4",[tenantId,`${claim.platform}:${claim.account_id}`,claim.external_order_id,masterSkuId])).rows[0];
  if(Number(priorReceived.qty)+quantity>Math.min(Number(ordered.qty)*packSize,Number(consumed.qty)))throw Object.assign(new Error('Approved return exceeds stock actually dispatched from the central ledger'),{status:409});
  const location=(await db.query("SELECT id FROM ci_location WHERE tenant_id=$1 AND id=$2 AND location_type IN ('warehouse','store')",[tenantId,locationId])).rows[0];
  if(!location)throw Object.assign(new Error('Choose a physical warehouse or store location'),{status:400});
  const event=await applyInventoryEventInTransaction(db,{tenantId,masterSkuId,locationId,eventKey:`return:${returnId}:${requestId}`,eventType:'return_qc_approved',source:`return:${claim.platform}:${claim.account_id}`,externalReference:claim.external_return_id,delta_on_hand:quantity});
  const receipt=(await db.query('INSERT INTO ci_return_receipt(tenant_id,return_id,request_id,master_sku_id,location_id,quantity,event_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[tenantId,returnId,requestId,masterSkuId,locationId,quantity,event.eventId])).rows[0];
  await db.query("UPDATE ci_return_case SET qc_status='approved',restocked_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,returnId]);
  await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'return_restocked',$4) ON CONFLICT DO NOTHING`,[tenantId,order.id,`return:${returnId}:${requestId}:restocked`,JSON.stringify({skuId:masterSkuId,quantity,locationId})]);
  return {duplicate:false,receiptId:receipt.id,eventId:event.eventId};
 });
}
