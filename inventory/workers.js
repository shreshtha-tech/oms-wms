import { readReconciliationPage } from './reconciliation-page.js';
import { recoverExpiredPublications } from './publication-recovery.js';
import { recordStockObservation } from './stock-observations.js';
import { orderAlertPolicy } from './order-alert-policy.js';
import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { openCredential } from './credentials.js';
import { ShopifyConnector } from './connectors/shopify.js';
import { AmazonConnector } from './connectors/amazon.js';
import { acquireAccountQuota } from './rate-limit.js';
import { applyInventoryEventInTransaction } from './ledger.js';
import { currentCredentials } from './connection-setup.js';
import { wooRequest, amazonOrigins } from './connection-provider.js';
import { logSyncAttempt, tryLogSyncAttempt, safeAccountFailure } from './sync-attempts.js';
import { markOrderIntake } from './unified-orders.js';
import { routePackingReadyForOrder } from './order-alert-routing.js';
import { releaseStockMappingLock } from './stock-lock-cleanup.js';
async function providerDispatchAuthorized(db,task,orderId,platform,revision){
 const row=(await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[task.tenant_id,task.account_id])).rows[0];
 if(row?.settings?.providerAuthoritative===true)return true;
 await db.query(`INSERT INTO ci_dispatch_review(tenant_id,account_id,external_order_id,reason)
  VALUES($1,$2,$3,'provider_full_shipment_without_authority')
  ON CONFLICT(tenant_id,account_id,external_order_id,reason) DO UPDATE SET last_observed_at=now()`,[task.tenant_id,task.account_id,orderId]);
 const order=(await db.query('SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND platform=$3 AND external_order_id=$4',[task.tenant_id,task.account_id,platform,orderId])).rows[0];
 if(order)await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail)
  VALUES($1,$2,$3,'fulfillment_reconciliation_required',$4) ON CONFLICT(tenant_id,event_key) DO NOTHING`,
  [task.tenant_id,order.id,`${platform}:${task.account_id}:${orderId}:provider-authority:${revision||'unknown'}`,JSON.stringify({reason:'provider_full_shipment_without_authority'})]);
 return false;
}
async function recordProviderDispatchEvidence(db,task,eventId,orderId,lineId,revision){
 await db.query(`INSERT INTO ci_dispatch_evidence(tenant_id,event_id,account_id,external_order_id,external_line_id,evidence_type,source_revision)
  VALUES($1,$2,$3,$4,$5,'provider-evidence',$6) ON CONFLICT DO NOTHING`,[task.tenant_id,eventId,task.account_id,orderId,lineId,revision||null]);
}
function physicalOrderQuantity(listingQuantity,packSize){
  const quantity=listingQuantity*packSize;
  if(!Number.isSafeInteger(listingQuantity)||listingQuantity<=0||!Number.isSafeInteger(packSize)||packSize<=0||!Number.isSafeInteger(quantity))throw new Error('Mapped order quantity must be a positive safe integer in physical units');
  return quantity;
}

function requireReservationMapping(reservation,mapping){
  if(reservation.master_sku_id!==mapping.master_sku_id||reservation.location_id!==mapping.internal_location_id)throw new Error('Active reservation identity differs from current SKU/location mapping; reconcile before processing');
}

async function lockCurrentProviderOrder(db,{tenantId,accountId,platform,externalOrderId,providerRevision}){
  const parsedRevision=providerRevision&&Number.isFinite(Date.parse(providerRevision))?new Date(providerRevision).toISOString():null;
  const current=await db.query(`SELECT id,provider_updated_at,
    ($5::timestamptz IS NOT NULL AND provider_updated_at>$5::timestamptz) AS stale
    FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND platform=$3 AND external_order_id=$4 FOR UPDATE`,
    [tenantId,accountId,platform,externalOrderId,parsedRevision]);
  if(!current.rowCount)throw new Error('Provider order snapshot is missing before inventory processing');
  if(current.rows[0].stale===true)return false;
  return (await orderAlertPolicy(db,{tenantId,orderId:current.rows[0].id})).stockAllowed;
}

async function processShopifyOrder(task){
  const {topic,event}=task.payload,orderId=String(event.id||'');if(!orderId||!Array.isArray(event.line_items))throw new Error('Shopify order payload lacks ID or line items');
  return transaction(async db=>{
    if(!await lockCurrentProviderOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,platform:'shopify',externalOrderId:orderId,providerRevision:event.updated_at||event.updatedAt}))return {stale:true};
    const prepared=[];
    for(const line of event.line_items){const sku=String(line.sku||''),lineId=String(line.id||''),qty=Number(line.quantity);
      if(!sku||!lineId||!Number.isSafeInteger(qty)||qty<=0)throw new Error('Shopify line lacks stable SKU, ID or quantity');
      const mapping=await db.query("SELECT m.master_sku_id,m.internal_location_id,m.pack_size FROM ci_channel_mapping m JOIN ci_location l ON l.tenant_id=m.tenant_id AND l.id=m.internal_location_id WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.external_sku=$3 AND m.active=true AND l.location_type IN ('warehouse','store')",[task.tenant_id,task.account_id,sku]);
      if(mapping.rowCount!==1)throw new Error(`Shopify line ${lineId} has no unique physical SKU/location mapping`);
      prepared.push({sku,lineId,...mapping.rows[0],qty:physicalOrderQuantity(qty,mapping.rows[0].pack_size)});
    }
    if(!prepared.length)throw new Error('Shopify order has no physical lines to reserve or cancel');
    prepared.sort((a,b)=>`${a.master_sku_id}:${a.internal_location_id}:${a.lineId}`.localeCompare(`${b.master_sku_id}:${b.internal_location_id}:${b.lineId}`));
    const persistedLines=(await db.query('SELECT external_line_id FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3)',[task.tenant_id,task.account_id,orderId])).rows.map(row=>row.external_line_id).sort();
    const eventLines=prepared.map(line=>line.lineId).sort();
    if(persistedLines.length!==eventLines.length||persistedLines.some((line,index)=>line!==eventLines[index]))throw new Error('Shopify order line set differs from the persisted provider order snapshot');
    for(const line of prepared){
      const base={tenantId:task.tenant_id,masterSkuId:line.master_sku_id,locationId:line.internal_location_id,source:`shopify:${task.account_id}`,externalReference:orderId};
      const args=[task.tenant_id,base.source,orderId,line.lineId];
      const terminal=(await db.query('SELECT terminal_status FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',args)).rows[0];
      if(topic==='orders/create'){
        if(terminal){if(terminal.terminal_status==='canceled')continue;throw new Error(`Shopify order conflicts with terminal line ${line.lineId}`);}
        await applyInventoryEventInTransaction(db,{...base,eventKey:`shopify:${task.account_id}:${orderId}:${line.lineId}:reserve`,eventType:'reserve',delta_reserved_order:line.qty,reservation:{action:'reserve',orderId,lineId:line.lineId,quantity:line.qty}});
      }else{
        if(terminal){if(terminal.terminal_status==='canceled')continue;throw new Error(`Shopify cancellation conflicts with terminal line ${line.lineId}`);}
        const existing=await db.query('SELECT * FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4 FOR UPDATE',args);
        if(existing.rows[0]?.status==='active')requireReservationMapping(existing.rows[0],line);
        if(existing.rows[0]?.status==='active')await applyInventoryEventInTransaction(db,{...base,eventKey:`shopify:${task.account_id}:${orderId}:${line.lineId}:cancel`,eventType:'cancel',delta_reserved_order:-line.qty,reservation:{action:'release',orderId,lineId:line.lineId,quantity:line.qty}});
        await db.query("INSERT INTO ci_order_line_state(tenant_id,source,external_order_id,external_line_id,terminal_status) VALUES($1,$2,$3,$4,'canceled') ON CONFLICT DO NOTHING",args);
      }
    }
    if(topic==='orders/create'){
      const reserved=await db.query("SELECT count(*)::integer AS count FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND status='active'",[task.tenant_id,`shopify:${task.account_id}`,orderId]);
      if(Number(reserved.rows[0].count)===prepared.length){await markOrderIntake(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:orderId});await routePackingReadyForOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:orderId});}
    }else{
      const canceled=await db.query("SELECT count(*)::integer AS count FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=ANY($4::text[]) AND terminal_status='canceled'",[task.tenant_id,`shopify:${task.account_id}`,orderId,eventLines]);
      if(Number(canceled.rows[0].count)!==prepared.length)throw new Error('Shopify order is not fully canceled across all mapped lines');
      await db.query("UPDATE ci_unified_order SET work_status='cancelled',updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3",[task.tenant_id,task.account_id,orderId]);
    }
  });
}
async function processWooOrder(task){
 const event=task.payload.event;
 if(task.payload.topic==='product.updated')return;
 if(!event?.id||!Array.isArray(event.line_items))throw new Error('WooCommerce order lacks stable order/line identities');
 if(!['processing','on-hold','completed','cancelled','failed','refunded'].includes(event.status))return;
 if(!event.line_items.length&&event.status!=='refunded')throw new Error('WooCommerce order has no physical lines to process');
 return transaction(async db=>{
  if(!await lockCurrentProviderOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,platform:'woocommerce',externalOrderId:String(event.id),providerRevision:event.providerUpdatedAt||event.date_modified_gmt||event.date_modified}))return {stale:true};
  if(event.status==='completed'&&!await providerDispatchAuthorized(db,task,String(event.id),'woocommerce',event.providerUpdatedAt||event.date_modified_gmt||event.date_modified))return {reviewRequired:true};
  const prepared=[];
  for(const line of event.line_items){if(!line.sku||!line.id||!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw new Error('WooCommerce order line is invalid');
   const mapping=await db.query("SELECT m.* FROM ci_channel_mapping m JOIN ci_location l ON l.tenant_id=m.tenant_id AND l.id=m.internal_location_id WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.external_sku=$3 AND m.active=true AND l.location_type IN ('warehouse','store')",[task.tenant_id,task.account_id,line.sku]);
   if(mapping.rowCount!==1)throw new Error('WooCommerce order line has no unique physical mapping');prepared.push({...mapping.rows[0],line});}
  prepared.sort((a,b)=>`${a.master_sku_id}:${a.internal_location_id}:${a.line.id}`.localeCompare(`${b.master_sku_id}:${b.internal_location_id}:${b.line.id}`));
  if(event.status!=='refunded'){
   const sourceLines=(await db.query('SELECT external_line_id FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3)',[task.tenant_id,task.account_id,String(event.id)])).rows.map(row=>row.external_line_id).sort();
   const eventLines=prepared.map(m=>String(m.line.id)).sort();
   if(sourceLines.length!==eventLines.length||sourceLines.some((line,index)=>line!==eventLines[index]))throw new Error('WooCommerce order line set differs from the persisted provider order snapshot');
  }
  for(const m of prepared){const source=`woocommerce:${task.account_id}`,orderId=String(event.id),lineId=String(m.line.id),qty=physicalOrderQuantity(m.line.quantity,m.pack_size),args=[task.tenant_id,source,orderId,lineId];
   const cancel=['cancelled','failed'].includes(event.status);
   const prior=(await db.query('SELECT * FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',args)).rows[0];
   const terminal=(await db.query('SELECT * FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',args)).rows[0];
   if(terminal){if(event.status==='completed'&&terminal.terminal_status!=='shipped')throw new Error(`WooCommerce completion conflicts with terminal line ${lineId}`);if(cancel&&terminal.terminal_status!=='canceled')throw new Error(`WooCommerce cancellation conflicts with terminal line ${lineId}`);continue;}
   if(prior?.status==='active')requireReservationMapping(prior,m);
   if(prior&&Number(prior.quantity)!==qty)throw new Error('WooCommerce order quantity changed; reconcile the line before processing');
   const base={tenantId:task.tenant_id,masterSkuId:m.master_sku_id,locationId:m.internal_location_id,source,externalReference:orderId};
   // Refunds are financial events, not proof that physical goods were received.
   if(event.status==='refunded')continue;
   if(!prior&&!cancel)await applyInventoryEventInTransaction(db,{...base,eventKey:`${source}:${orderId}:${lineId}:reserve`,eventType:'reserve',delta_reserved_order:qty,reservation:{action:'reserve',orderId,lineId,quantity:qty}});
  if(event.status==='completed'||cancel){if(prior?.status==='active'||(!prior&&!cancel)){const movement=await applyInventoryEventInTransaction(db,{...base,eventKey:`${source}:${orderId}:${lineId}:${cancel?'cancel':'dispatch'}`,eventType:cancel?'cancel':'dispatch',delta_reserved_order:-qty,delta_on_hand:cancel?0:-qty,reservation:{action:cancel?'release':'consume',orderId,lineId,quantity:qty}});if(!cancel)await recordProviderDispatchEvidence(db,task,movement.eventId,orderId,lineId,event.providerUpdatedAt||event.date_modified_gmt||event.date_modified);}await db.query('INSERT INTO ci_order_line_state(tenant_id,source,external_order_id,external_line_id,terminal_status) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...args,cancel?'canceled':'shipped']);}
  }
  if(event.status==='completed'){
   const shipped=await db.query("SELECT count(*)::integer AS count FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=ANY($4::text[]) AND terminal_status='shipped'",[task.tenant_id,`woocommerce:${task.account_id}`,String(event.id),prepared.map(m=>String(m.line.id))]);
   if(Number(shipped.rows[0].count)!==prepared.length)throw new Error('WooCommerce order is not fully dispatched across all mapped lines');
  }
  if(['processing','on-hold','completed'].includes(event.status))await markOrderIntake(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:String(event.id)});
  if(['processing','on-hold'].includes(event.status))await routePackingReadyForOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:String(event.id)});
  if(event.status==='completed')await db.query("UPDATE ci_unified_order SET work_status='dispatched',updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3",[task.tenant_id,task.account_id,String(event.id)]);
  if(['cancelled','failed'].includes(event.status)){
   const canceled=await db.query("SELECT count(*)::integer AS count FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=ANY($4::text[]) AND terminal_status='canceled'",[task.tenant_id,`woocommerce:${task.account_id}`,String(event.id),prepared.map(m=>String(m.line.id))]);
   if(Number(canceled.rows[0].count)!==prepared.length)throw new Error('WooCommerce order is not fully canceled across all mapped lines');
   await db.query("UPDATE ci_unified_order SET work_status='cancelled',updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3",[task.tenant_id,task.account_id,String(event.id)]);
  }
 });
}
async function processAmazonOrder(task){
  const notification=task.payload.Payload?.OrderChangeNotification,summary=notification?.Summary;
  if(!notification||summary?.FulfillmentType!=='MFN')return;
  const orderId=String(notification.AmazonOrderId||''),status=summary.OrderStatus;
  if(notification.NotificationLevel!=='OrderLevel')throw new Error('Amazon MFN inventory transitions require an OrderLevel notification snapshot; item-level fulfillment needs shipment-quantity and package identity reconciliation');
  if(!orderId||!Array.isArray(summary.OrderItems)||summary.OrderItems.length===0)throw new Error('Amazon order notification lacks physical items');
  if(status==='PartiallyShipped')return transaction(async db=>{
    if(!await lockCurrentProviderOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,platform:'amazon',externalOrderId:orderId,providerRevision:notification.OrderChangeTrigger?.TimeOfOrderChange}))return {stale:true};
    const order=(await db.query('SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND platform=$3 AND external_order_id=$4',[task.tenant_id,task.account_id,'amazon',orderId])).rows[0];
    await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail)
      VALUES($1,$2,$3,'fulfillment_reconciliation_required',$4) ON CONFLICT(tenant_id,event_key) DO NOTHING`,
      [task.tenant_id,order.id,`amazon:${task.account_id}:${orderId}:partial:${notification.OrderChangeTrigger?.TimeOfOrderChange||notification.NotificationMetadata?.NotificationId||'unknown'}`,JSON.stringify({reason:'partial_shipment',providerStatus:status,items:summary.OrderItems.map(item=>({lineId:item.OrderItemId,quantity:item.Quantity,quantityShipped:item.QuantityShipped??null}))})]);
    await db.query("UPDATE ci_unified_order SET work_status='partially_shipped',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND work_status NOT IN ('dispatched','returned','cancelled')",[task.tenant_id,order.id]);
    await db.query(`INSERT INTO ci_dispatch_review(tenant_id,account_id,external_order_id,reason)
      VALUES($1,$2,$3,'partial_shipment_contract_pending')
      ON CONFLICT(tenant_id,account_id,external_order_id,reason) DO UPDATE SET last_observed_at=now()`,[task.tenant_id,task.account_id,orderId]);
    return {reconciliationRequired:true};
  });
  if(!['Unshipped','Canceled','Shipped'].includes(status))return;
  if(status==='Shipped'&&summary.OrderItems.some(item=>item.QuantityShipped!==undefined&&Number(item.QuantityShipped)!==Number(item.Quantity)))throw new Error('Amazon Shipped snapshot includes a partial item quantity; reconcile shipment quantities before stock deduction');
  return transaction(async db=>{
    if(!await lockCurrentProviderOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,platform:'amazon',externalOrderId:orderId,providerRevision:notification.OrderChangeTrigger?.TimeOfOrderChange}))return {stale:true};
    if(status==='Shipped'&&!await providerDispatchAuthorized(db,task,orderId,'amazon',notification.OrderChangeTrigger?.TimeOfOrderChange))return {reviewRequired:true};
    const prepared=[];
    for(const item of summary.OrderItems){const sku=String(item.SellerSKU||''),lineId=String(item.OrderItemId||''),qty=Number(item.Quantity);
      if(!sku||!lineId||!Number.isSafeInteger(qty)||qty<=0)throw new Error('Amazon order item lacks stable SKU, ID or quantity');
      const mapping=await db.query("SELECT m.master_sku_id,m.internal_location_id,m.pack_size FROM ci_channel_mapping m JOIN ci_location l ON l.tenant_id=m.tenant_id AND l.id=m.internal_location_id WHERE m.tenant_id=$1 AND m.account_id=$2 AND m.external_sku=$3 AND m.active=true AND l.location_type IN ('warehouse','store') AND (m.external_location_id='' OR m.external_location_id=$4)",[task.tenant_id,task.account_id,sku,String(item.SupplySourceId||'')]);
      if(mapping.rowCount!==1)throw new Error(`Amazon item ${lineId} has no unique MFN SKU/location mapping`);
      prepared.push({lineId,...mapping.rows[0],qty:physicalOrderQuantity(qty,mapping.rows[0].pack_size)});
    }
    prepared.sort((a,b)=>`${a.master_sku_id}:${a.internal_location_id}:${a.lineId}`.localeCompare(`${b.master_sku_id}:${b.internal_location_id}:${b.lineId}`));
    const persistedLines=(await db.query('SELECT external_line_id FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3)',[task.tenant_id,task.account_id,orderId])).rows.map(row=>row.external_line_id).sort();
    const notificationLines=prepared.map(item=>item.lineId).sort();
    if(persistedLines.length!==notificationLines.length||persistedLines.some((line,index)=>line!==notificationLines[index]))throw new Error('Amazon OrderLevel item set differs from the persisted provider order snapshot');
    if(status==='Canceled'||status==='Shipped'){
      const unresolvedPartial=await db.query(`SELECT 1 FROM ci_order_timeline t
        WHERE t.tenant_id=$1 AND t.order_id=(SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3)
        AND t.event_type='fulfillment_reconciliation_required' AND t.detail->>'reason'='partial_shipment'
        AND EXISTS(SELECT 1 FROM ci_reservation r WHERE r.tenant_id=$1 AND r.source=$4 AND r.external_order_id=$3 AND r.status='active') LIMIT 1`,
        [task.tenant_id,task.account_id,orderId,`amazon:${task.account_id}`]);
      if(unresolvedPartial.rowCount)throw new Error('Amazon shipment or cancellation after partial shipment requires quantity and package reconciliation; active stock reservation remains unchanged');
    }
    for(const item of prepared){const source=`amazon:${task.account_id}`,base={tenantId:task.tenant_id,masterSkuId:item.master_sku_id,locationId:item.internal_location_id,source,externalReference:orderId};
      const args=[task.tenant_id,source,orderId,item.lineId];
      const terminal=await db.query('SELECT terminal_status FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',args);if(terminal.rowCount){if(status==='Unshipped'||terminal.rows[0].terminal_status===(status==='Canceled'?'canceled':'shipped'))continue;throw new Error(`Conflicting Amazon terminal status for ${item.lineId}`);}
      if(status==='Unshipped'){await applyInventoryEventInTransaction(db,{...base,eventKey:`amazon:${task.account_id}:${orderId}:${item.lineId}:reserve`,eventType:'reserve',delta_reserved_order:item.qty,reservation:{action:'reserve',orderId,lineId:item.lineId,quantity:item.qty}});}
      else{const prior=await db.query('SELECT * FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4 FOR UPDATE',[task.tenant_id,source,orderId,item.lineId]);if(status==='Shipped'&&prior.rows[0]?.status!=='active')throw new Error(`Amazon shipped line ${item.lineId} has no active reservation; reconcile before stock deduction`);
        if(prior.rows[0]?.status==='active')requireReservationMapping(prior.rows[0],item);
        if(prior.rows[0]?.status==='active'){const movement=await applyInventoryEventInTransaction(db,{...base,eventKey:`amazon:${task.account_id}:${orderId}:${item.lineId}:${status}`,eventType:status==='Canceled'?'cancel':'dispatch',delta_reserved_order:-item.qty,delta_on_hand:status==='Shipped'?-item.qty:0,reservation:{action:status==='Canceled'?'release':'consume',orderId,lineId:item.lineId,quantity:item.qty}});if(status==='Shipped')await recordProviderDispatchEvidence(db,task,movement.eventId,orderId,item.lineId,notification.OrderChangeTrigger?.TimeOfOrderChange);}}
      if(status!=='Unshipped')await db.query('INSERT INTO ci_order_line_state(tenant_id,source,external_order_id,external_line_id,terminal_status) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...args,status==='Canceled'?'canceled':'shipped']);
    }
    if(status==='Shipped'){
      const shipped=await db.query("SELECT count(*)::integer AS count FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=ANY($4::text[]) AND terminal_status='shipped'",[task.tenant_id,`amazon:${task.account_id}`,orderId,notificationLines]);
      if(Number(shipped.rows[0].count)!==prepared.length)throw new Error('Amazon order is not fully shipped across all mapped lines');
    }
    if(status==='Unshipped'||status==='Shipped')await markOrderIntake(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:orderId});
    if(status==='Unshipped')await routePackingReadyForOrder(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:orderId});
    if(status==='Shipped')await db.query("UPDATE ci_unified_order SET work_status='dispatched',updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3",[task.tenant_id,task.account_id,orderId]);
    if(status==='Canceled'){
      const canceled=await db.query("SELECT count(*)::integer AS count FROM ci_order_line_state WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=ANY($4::text[]) AND terminal_status='canceled'",[task.tenant_id,`amazon:${task.account_id}`,orderId,notificationLines]);
      if(Number(canceled.rows[0].count)!==prepared.length)throw new Error('Amazon order is not fully canceled across all mapped lines');
      await db.query("UPDATE ci_unified_order SET work_status='cancelled',updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3",[task.tenant_id,task.account_id,orderId]);
    }
  });
}

async function loadAccount(db,tenantId,id){const r=await db.query('SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND status=$3',[tenantId,id,'active']);if(!r.rowCount)throw new Error('Active channel account unavailable');return r.rows[0];}
function safeProviderResponseReference(platform,response){
  const candidates=platform==='shopify'
    ?[response?.inventoryAdjustmentGroup?.id,response?.inventoryAdjustmentGroup?.createdAt]
    :platform==='amazon'
      ?[response?.submissionId]
      :[response?.id===undefined?null:`product:${response.id}`];
  const value=candidates.find(item=>(typeof item==='string'&&item.trim())||typeof item==='number');
  return value===undefined||value===null?null:String(value).slice(0,200);
}
async function markPublicationMutation(db,task,row,account,quantity,requestId){
  if(!Number.isSafeInteger(Number(task.id))||Number(task.id)<=0)throw new Error('Stock publication requires a durable outbox identity');
  const sourceEventId=typeof task.payload?.eventId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task.payload.eventId)?task.payload.eventId:null;
  await db.query('BEGIN');
  try{
    const marked=await db.query(`UPDATE ci_outbox SET remote_attempt_started_at=now(),remote_target_quantity=$4,remote_request_id=$5,
      publication_state='SENDING',provider_platform=$6,internal_sku_id=$7,external_sku=$8,provider_listing_id=$9,
      internal_location_id=$10,provider_location_id=$11,pack_size=$12,source_event_id=$13,expected_quantity=$4,
      provider_response_reference=NULL,acknowledged_at=NULL,readback_quantity=NULL,readback_at=NULL,reconciliation_result=NULL
      WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status='processing' AND remote_attempt_started_at IS NULL RETURNING id`,
      [task.tenant_id,task.id,task.attempts,quantity,requestId,account.platform,row.master_sku_id,row.external_sku,row.listing_id,
        row.internal_location_id,row.external_location_id,row.pack_size,sourceEventId]);
    if(!marked.rowCount)throw new Error('Stock publication lease changed before remote mutation');
    await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,publish_state,updated_at)
      VALUES($1,$2,$3,'sending',now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET
      target_quantity=EXCLUDED.target_quantity,publish_state='sending',updated_at=now()`,[task.tenant_id,task.mapping_id,quantity]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  task.remoteTargetQuantity=quantity;task.remoteRequestId=requestId;task.remoteDispatched=true;task.publicationState='SENDING';
}
async function recordPublicationAcknowledgement(db,task,platform,response){
  const reference=safeProviderResponseReference(platform,response);
  await db.query('BEGIN');
  try{
    const result=await db.query(`UPDATE ci_outbox SET provider_response_reference=$4,acknowledged_at=now(),publication_state='ACKNOWLEDGED'
      WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status='processing' AND remote_attempt_started_at IS NOT NULL RETURNING id`,
      [task.tenant_id,task.id,task.attempts,reference]);
    if(!result.rowCount)throw Object.assign(new Error('Provider acknowledged stock, but local acknowledgement is unresolved'),{code:'REMOTE_OUTCOME_UNKNOWN'});
    await db.query("UPDATE ci_channel_stock SET publish_state='acknowledged',updated_at=now() WHERE tenant_id=$1 AND mapping_id=$2",[task.tenant_id,task.mapping_id]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  task.providerAcknowledged=true;task.providerResponseReference=reference;task.publicationState='ACKNOWLEDGED';
}
async function recordPublicationReadback(db,task,quantity,readback){
  const matches=readback===quantity,state=matches?'RECONCILED':'MISMATCH',result=matches?'MATCHED_EXPECTED':'READBACK_MISMATCH';
  const at=new Date();
  await db.query('BEGIN');
  try{
    const recorded=await db.query(`UPDATE ci_outbox SET readback_quantity=$4,readback_at=$5,publication_state=$6,reconciliation_result=$7
      WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status='processing' RETURNING id`,[task.tenant_id,task.id,task.attempts,readback,at,state,result]);
    if(!recorded.rowCount)throw Object.assign(new Error('Publication readback arrived after the outbox lease changed'),{code:'REMOTE_OUTCOME_UNKNOWN'});
    await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,publish_state,readback_quantity,readback_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET target_quantity=EXCLUDED.target_quantity,
        publish_state=EXCLUDED.publish_state,readback_quantity=EXCLUDED.readback_quantity,readback_at=EXCLUDED.readback_at,updated_at=now()`,
      [task.tenant_id,task.mapping_id,quantity,matches?'confirmed':'requires_reconciliation',readback,at]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  task.publicationState=state;task.remoteReadbackQuantity=readback;
  if(!matches)throw Object.assign(new Error('Provider stock readback differs from the target; operator reconciliation is required'),{code:'PUBLICATION_MISMATCH'});
}
async function recordMatchedReadWithoutMutation(db,task,row,account,quantity,requestId,readback){
  if(!Number.isSafeInteger(Number(task.id))||Number(task.id)<=0)throw new Error('Stock publication requires a durable outbox identity');
  const sourceEventId=typeof task.payload?.eventId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(task.payload.eventId)?task.payload.eventId:null;
  const at=new Date();
  await db.query('BEGIN');
  try{
  const recorded=await db.query(`UPDATE ci_outbox SET provider_platform=$4,internal_sku_id=$5,external_sku=$6,provider_listing_id=$7,
    internal_location_id=$8,provider_location_id=$9,pack_size=$10,source_event_id=$11,expected_quantity=$12,
    remote_request_id=$13,readback_quantity=$14,readback_at=$15,publication_state='RECONCILED',
    reconciliation_result='ALREADY_MATCHED',remote_attempt_started_at=NULL,remote_target_quantity=$12
    WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status='processing' RETURNING id`,
    [task.tenant_id,task.id,task.attempts,account.platform,row.master_sku_id,row.external_sku,row.listing_id,row.internal_location_id,
      row.external_location_id,row.pack_size,sourceEventId,quantity,requestId,readback,at]);
  if(!recorded.rowCount)throw new Error('Publication readback arrived after the outbox lease changed');
  await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,publish_state,readback_quantity,readback_at,updated_at)
    VALUES($1,$2,$3,'confirmed',$4,$5,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET target_quantity=EXCLUDED.target_quantity,
    publish_state='confirmed',readback_quantity=EXCLUDED.readback_quantity,readback_at=EXCLUDED.readback_at,updated_at=now()`,
    [task.tenant_id,task.mapping_id,quantity,readback,at]);
  await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  task.publicationState='RECONCILED';
}
export async function publishStockTask(task,{fetcher,pool=inventoryPool()}={}){
  // Hold one PostgreSQL session lock across the remote write. A later task for
  // this listing must read the latest balance only after the prior write ends.
  const db=await pool.connect();
  const lockKey=`stock:${task.tenant_id}:${task.mapping_id}`;
  let locked=false,operationError;
  try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lockKey]);
  locked=true;
  const unresolved=await db.query(`SELECT id FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock'
    AND remote_attempt_started_at IS NOT NULL AND status IN ('processing','held') AND publication_state IS DISTINCT FROM 'RECONCILED'
    AND id IS DISTINCT FROM $3 LIMIT 1`,[task.tenant_id,task.mapping_id,task.id??null]);
  if(unresolved.rowCount)throw Object.assign(new Error('Earlier stock publication has an unresolved remote outcome; readback required'),{code:'REMOTE_OUTCOME_UNKNOWN'});
  if(task.id!=null){
    const current=(await db.query('SELECT remote_attempt_started_at FROM ci_outbox WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status=$4',[task.tenant_id,task.id,task.attempts,'processing'])).rows[0];
    if(!current||current.remote_attempt_started_at)throw Object.assign(new Error('Stock publication lease is missing or prior remote outcome is unresolved'),{code:'REMOTE_OUTCOME_UNKNOWN'});
  }
  if(!Number.isSafeInteger(Number(task.id))||Number(task.id)<=0)throw new Error('Stock publication requires a durable outbox identity');
  const account=await loadAccount(db,task.tenant_id,task.account_id),secret=await currentCredentials(account);
  const result=await db.query('SELECT m.*,b.*,s.observed_quantity FROM ci_channel_mapping m JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id LEFT JOIN ci_channel_stock s ON s.tenant_id=m.tenant_id AND s.mapping_id=m.id WHERE m.tenant_id=$1 AND m.id=$2 AND m.active=true',[task.tenant_id,task.mapping_id]);
  if(!result.rowCount)throw new Error('Active channel mapping or balance unavailable');const row=result.rows[0];
  const available=Math.max(0,Number(row.on_hand)-Number(row.reserved_order)-Number(row.reserved_cart)-Number(row.damaged)-Number(row.quarantined)-Number(row.safety_stock));const quantity=Math.floor(available/row.pack_size);
  const requestId=createHash('sha256').update(`${task.tenant_id}:${task.mapping_id}:${row.version}:${quantity}`).digest('hex');
  const markRemoteMutation=()=>markPublicationMutation(db,task,row,account,quantity,requestId);
  let readback=null;
  if(account.platform==='shopify'){
    const connector=new ShopifyConnector({fetcher,shop:account.external_account_id,token:secret.accessToken,clientId:secret.refreshToken?undefined:secret.clientId,clientSecret:secret.refreshToken?undefined:secret.clientSecret,apiVersion:secret.apiVersion||'2026-07',rateControl:cost=>acquireAccountQuota({tenantId:task.tenant_id,accountId:account.id,cost,rate:Number(account.settings.restoreRate||100),burst:Number(account.settings.bucketSize||1000)})});
    const observed=await connector.readQuantity(row.listing_id,row.external_location_id);
    if(observed===null)throw new Error('Shopify inventory level unavailable; cannot compare and set');
    // A retried old task may now represent a newer balance. Key Shopify's
    // idempotent mutation to that balance version, not the old outbox event.
    const digest=createHash('sha256').update(`${task.mapping_id}:${row.version}:${quantity}`).digest('hex');
    const idempotencyKey=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    if(observed!==quantity){await markRemoteMutation();const acknowledgement=await connector.setQuantity({inventoryItemId:row.listing_id,locationId:row.external_location_id,quantity,compareQuantity:observed,referenceDocumentUri:`central-inventory://balance/${task.mapping_id}/${row.version}`,idempotencyKey});await recordPublicationAcknowledgement(db,task,'shopify',acknowledgement);}
    readback=observed===quantity?observed:await connector.readQuantity(row.listing_id,row.external_location_id);
    if(!task.remoteDispatched)await recordMatchedReadWithoutMutation(db,task,row,account,quantity,requestId,readback);
    else await recordPublicationReadback(db,task,quantity,readback);
  }else if(account.platform==='amazon'){
    const fulfillmentChannelCode=String(row.external_location_id||'').trim();
    if(!fulfillmentChannelCode)throw new Error('Amazon MFN mapping has no approved fulfillment channel code');
    const connector=new AmazonConnector({...secret,fetcher,sellerId:secret.sellerId||account.external_account_id,marketplaceId:secret.marketplaceId||account.settings.marketplaceId,endpoint:amazonOrigins[secret.region]||undefined,rateControl:cost=>acquireAccountQuota({tenantId:task.tenant_id,accountId:account.id,cost,rate:5,burst:10})});
    await markRemoteMutation();
    const acknowledgement=await connector.patchMfnQuantity({sellerSku:row.external_sku,quantity,productType:account.settings.productType||'PRODUCT',fulfillmentChannelCode});
    if(acknowledgement.status!=='ACCEPTED'||acknowledgement.sku!==row.external_sku)throw new Error('Amazon did not acknowledge this seller SKU quantity submission');
    await recordPublicationAcknowledgement(db,task,'amazon',acknowledgement);
    readback=await connector.getMfnQuantity({sellerSku:row.external_sku,fulfillmentChannelCode});
    await recordPublicationReadback(db,task,quantity,readback);
  }else if(account.platform==='woocommerce'){
    if(secret.locationPlugin)throw new Error('WooCommerce location plugin is not supported');
    if(!/^\d+(\/variations\/\d+)?$/.test(row.listing_id))throw new Error('Invalid WooCommerce product/variation mapping');
    await acquireAccountQuota({tenantId:task.tenant_id,accountId:account.id,cost:1,rate:2,burst:5});
    const path=`/products/${row.listing_id}`,before=await wooRequest(secret,path,{fetcher});
    if(before.sku!==row.external_sku||before.manage_stock!==true)throw new Error('WooCommerce SKU or inventory tracking changed');
    if(before.stock_quantity!==quantity){await markRemoteMutation();const acknowledgement=await wooRequest(secret,path,{fetcher,method:'PUT',body:{manage_stock:true,stock_quantity:quantity}});await recordPublicationAcknowledgement(db,task,'woocommerce',acknowledgement);}
    const wooReadback=await wooRequest(secret,path,{fetcher});
    if(!task.remoteDispatched)await recordMatchedReadWithoutMutation(db,task,row,account,quantity,requestId,wooReadback.stock_quantity);
    else await recordPublicationReadback(db,task,quantity,wooReadback.stock_quantity);
    readback=wooReadback.stock_quantity;
  }else throw new Error(`Publishing for ${account.platform} is not configured`);
  return quantity;
  }catch(error){operationError=error;throw error;}finally{
    await releaseStockMappingLock(db,lockKey,{locked,primaryError:operationError});
  }
}
export async function processInventoryTask(task,{fetcher}={}){
  if(task.task_type==='publish_stock')return publishStockTask(task,{fetcher});
  if(task.task_type==='woocommerce_ingress')return processWooOrder(task);
  if(task.task_type==='shopify_ingress'&&task.payload.topic==='refunds/create')return;
  if(task.task_type==='shopify_ingress'&&['orders/create','orders/cancelled'].includes(task.payload.topic))return processShopifyOrder(task);
  if(task.task_type==='amazon_ingress'&&task.payload.NotificationType==='ORDER_CHANGE')return processAmazonOrder(task);
  // Ingress events are retained until explicit SKU/order mapping logic is configured.
  // Observations may be recorded without inventing stock movements.
  if(task.task_type==='amazon_ingress'&&task.payload.NotificationType==='LISTINGS_ITEM_MFN_QUANTITY_CHANGE'){
    const p=task.payload.Payload;const mapping=await inventoryPool().query('SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND account_id=$2 AND external_sku=$3 AND active=true',[task.tenant_id,task.account_id,p.Sku]);
    if(mapping.rowCount!==1)throw new Error('Amazon MFN quantity has no unambiguous mapping');
    await recordStockObservation({tenantId:task.tenant_id,mappingId:mapping.rows[0].id,quantity:p.Quantity,eventTime:task.payload.EventTime});return;
  }
  if(task.task_type==='shopify_ingress'&&task.payload.topic==='inventory_levels/update'){
    const p=task.payload.event,mapping=await inventoryPool().query('SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND account_id=$2 AND listing_id=$3 AND external_location_id=$4 AND active=true',[task.tenant_id,task.account_id,`gid://shopify/InventoryItem/${p.inventory_item_id}`,`gid://shopify/Location/${p.location_id}`]);
    if(mapping.rowCount!==1)throw new Error('Shopify level has no unambiguous mapping');
    await recordStockObservation({tenantId:task.tenant_id,mappingId:mapping.rows[0].id,quantity:p.available,eventTime:p.updated_at});return;
  }
  throw new Error(`Ingress ${task.task_type} requires approved order-line mapping before balance changes`);
}
export async function runInventoryTaskBatch(limit=1,{fetcher}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('Inventory task batch must be an integer from 1 to 100');
  const tenantId=process.env.INVENTORY_ALLOWED_TENANT_ID;
  if(!tenantId)throw new Error('INVENTORY_ALLOWED_TENANT_ID is required before claiming inventory tasks');
  const claimed=await transaction(async db=>{
    await recoverExpiredPublications(db,tenantId,limit);
    // A lease can expire after the final business attempt but before its
    // acknowledgement. Preserve that ambiguous outcome for reconciliation;
    // reclaiming it must not grant another business execution.
    await db.query("UPDATE ci_outbox SET status='dead',lease_until=NULL,last_error=COALESCE(last_error,'Attempt limit reached during recovery; business outcome requires reconciliation') WHERE tenant_id=$2 AND id IN (SELECT id FROM ci_outbox WHERE tenant_id=$2 AND attempts>=8 AND ((status IN ('pending','retry') AND available_at<=now()) OR (status='processing' AND lease_until<now())) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1)",[limit,tenantId]);
    return (await db.query("UPDATE ci_outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE tenant_id=$2 AND id IN (SELECT id FROM ci_outbox WHERE tenant_id=$2 AND attempts<8 AND ((status IN ('pending','retry') AND available_at<=now()) OR (status='processing' AND lease_until<now())) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) RETURNING *",[limit,tenantId])).rows;
  });
  for(const task of claimed){
    const attempt={tenantId:task.tenant_id,accountId:task.account_id,direction:task.task_type==='publish_stock'?'outbound':'inbound',operation:task.task_type};
    try{
      await processInventoryTask(task,{fetcher});
      await transaction(async db=>{
        const acknowledged=await db.query("UPDATE ci_outbox SET status='done',lease_until=NULL,last_error=NULL,remote_attempt_started_at=NULL WHERE tenant_id=$3 AND id=$1 AND attempts=$2 AND status='processing' RETURNING id",[task.id,task.attempts,tenantId]);
        if(!acknowledged.rowCount)return;
        await logSyncAttempt({...attempt,skuCount:task.mapping_id?1:(task.payload.event?.line_items?.length||0)},db);
      });
    }catch(error){
      const attempts=task.attempts,unknownRemote=task.task_type==='publish_stock'&&(task.remoteDispatched===true||error?.code==='REMOTE_OUTCOME_UNKNOWN');
      const publicationState=task.publicationState==='MISMATCH'?'MISMATCH':task.providerAcknowledged?'READBACK_PENDING':unknownRemote?'UNKNOWN_REMOTE_STATE':null;
      const safe={message:publicationState==='MISMATCH'?'Provider quantity differs from publication target; operator reconciliation required':publicationState==='READBACK_PENDING'?'Provider acknowledged stock; independent readback is pending':unknownRemote?'Remote stock publication outcome unknown; independent readback required':'Inventory task failed; diagnostic details unavailable'};
      const orderId=task.task_type==='amazon_ingress'?task.payload?.Payload?.OrderChangeNotification?.AmazonOrderId:task.payload?.event?.id;
      const failureRecorded=await transaction(async db=>{
        const failed=await db.query(`UPDATE ci_outbox SET status=$2,available_at=now()+($3||' seconds')::interval,
          lease_until=NULL,last_error=$4,remote_attempt_started_at=CASE WHEN $7::boolean THEN remote_attempt_started_at ELSE NULL END,
          publication_state=COALESCE($8,publication_state)
          WHERE tenant_id=$6 AND id=$1 AND attempts=$5 AND status='processing' RETURNING id`,
          [task.id,unknownRemote?'held':attempts>=8?'dead':'retry',String(Math.round(Math.min(3600,2**attempts*5)*(0.5+0.5*Math.random()))),safe.message,attempts,tenantId,unknownRemote,publicationState]);
        if(!failed.rowCount)return false;
        if(unknownRemote&&task.mapping_id&&task.remoteTargetQuantity!==undefined)await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,publish_state,readback_quantity,readback_at,updated_at)
          VALUES($1,$2,$3,$4,$5,CASE WHEN $5::bigint IS NULL THEN NULL ELSE now() END,now()) ON CONFLICT(tenant_id,mapping_id)
          DO UPDATE SET target_quantity=EXCLUDED.target_quantity,publish_state=EXCLUDED.publish_state,
            readback_quantity=COALESCE(EXCLUDED.readback_quantity,ci_channel_stock.readback_quantity),
            readback_at=COALESCE(EXCLUDED.readback_at,ci_channel_stock.readback_at),updated_at=now()`,
          [tenantId,task.mapping_id,task.remoteTargetQuantity,publicationState==='MISMATCH'?'requires_reconciliation':publicationState==='READBACK_PENDING'?'readback_pending':'unknown_remote',task.remoteReadbackQuantity??null]);
        if(orderId&&task.task_type.endsWith('_ingress'))await markOrderIntake(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:String(orderId),error:safe.message});
        return true;
      });
      // The outbox last_error is durable operator evidence. Optional diagnostic
      // storage must never roll back retry/DLQ or force another execution.
      if(failureRecorded&&!unknownRemote){
        // Credential lookup/redaction can stall as well as throw. Persist the
        // safe operational failure first; details may only enrich that state.
        const diagnostic=await safeAccountFailure(task.tenant_id,task.account_id,error);
        try{
          const enriched=await transaction(async db=>{
            const updated=await db.query("UPDATE ci_outbox SET last_error=$4 WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND status IN ('retry','dead','held') RETURNING id",[tenantId,task.id,attempts,diagnostic.message]);
            if(!updated.rowCount)return false;
            if(orderId&&task.task_type.endsWith('_ingress'))await markOrderIntake(db,{tenantId:task.tenant_id,accountId:task.account_id,externalOrderId:String(orderId),error:diagnostic.message});
            return true;
          });
          if(enriched)await tryLogSyncAttempt({...attempt,status:'failed',diagnostic});
        }catch{}
      }
    }
  }
  return claimed.length;
}
export async function inventoryDrift(tenantId){const {rows}=await inventoryPool().query('SELECT s.mapping_id,m.account_id,s.target_quantity,s.observed_quantity,s.observed_at FROM ci_channel_stock s JOIN ci_channel_mapping m ON m.id=s.mapping_id WHERE s.tenant_id=$1 AND s.observed_quantity IS DISTINCT FROM s.target_quantity',[tenantId]);return rows;}

async function withStockMappingLock(pool,tenantId,mappingId,operation){
  const client=await pool.connect(),lockKey=`stock:${tenantId}:${mappingId}`;
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lockKey]);locked=true;
    return await operation();
  }catch(error){throw error;}
  finally{
    await releaseStockMappingLock(client,lockKey,{locked});
  }
}

export async function reconcileShopifyStock(tenantId,{fetcher}={}){
  const db=inventoryPool();
  const rows=await readReconciliationPage(db,"SELECT m.id AS mapping_id,m.account_id,m.listing_id,m.external_location_id,m.pack_size,b.on_hand,b.reserved_order,b.reserved_cart,b.damaged,b.quarantined,b.safety_stock,b.version,a.* FROM ci_channel_mapping m JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id WHERE m.tenant_id=$1 AND m.active=true AND a.status='active' AND a.platform='shopify'",tenantId,'shopify');
  const connectors=new Map();
  const summary={checked:0,mismatched:0,unavailable:0,errors:[]};
  for(const row of rows){
    try{
      await withStockMappingLock(db,tenantId,row.mapping_id,async()=>{
      let connector=connectors.get(row.account_id);
      if(!connector){const secret=await currentCredentials(row);connector=new ShopifyConnector({fetcher,shop:row.external_account_id,token:secret.accessToken,clientId:secret.refreshToken?undefined:secret.clientId,clientSecret:secret.refreshToken?undefined:secret.clientSecret,apiVersion:secret.apiVersion||'2026-07',rateControl:cost=>acquireAccountQuota({tenantId,accountId:row.account_id,cost,rate:Number(row.settings.restoreRate||100),burst:Number(row.settings.bucketSize||1000)})});connectors.set(row.account_id,connector);}
      const observationStartedAt=new Date();
      const observed=await connector.readQuantity(row.listing_id,row.external_location_id);
      if(observed===null){summary.unavailable++;return;}
      const mismatch=await transaction(async tx=>{
        // The ledger may have changed while the remote read was in flight.
        const fresh=await tx.query("SELECT b.*,m.pack_size FROM ci_channel_mapping m JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id WHERE m.tenant_id=$1 AND m.id=$2 AND m.active=true AND a.status='active' FOR UPDATE OF b",[tenantId,row.mapping_id]);
        if(!fresh.rowCount)return null;
        const balance=fresh.rows[0];
        const available=Math.max(0,Number(balance.on_hand)-Number(balance.reserved_order)-Number(balance.reserved_cart)-Number(balance.damaged)-Number(balance.quarantined)-Number(balance.safety_stock));
        const target=Math.floor(available/balance.pack_size);
        const differs=Number(observed)!==target;
        const uncertain=(await tx.query(`SELECT id,remote_target_quantity FROM ci_outbox WHERE tenant_id=$1 AND mapping_id=$2
          AND task_type='publish_stock' AND status='held' AND remote_attempt_started_at IS NOT NULL
          ORDER BY id LIMIT 1 FOR UPDATE`,[tenantId,row.mapping_id])).rows[0];
        if(uncertain){
          const matchesAttempt=Number(observed)===Number(uncertain.remote_target_quantity);
          await tx.query(`UPDATE ci_outbox SET readback_quantity=$3,readback_at=$4,publication_state=$5,reconciliation_result=$6
            WHERE tenant_id=$1 AND id=$2 AND status='held'`,
            [tenantId,uncertain.id,observed,observationStartedAt,matchesAttempt?'RECONCILED':'MISMATCH',matchesAttempt?'MATCHED_ATTEMPT':'READBACK_MISMATCH']);
          await tx.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,readback_quantity,readback_at,publish_state,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET
            target_quantity=EXCLUDED.target_quantity,readback_quantity=EXCLUDED.readback_quantity,readback_at=EXCLUDED.readback_at,
            publish_state=EXCLUDED.publish_state,updated_at=now()`,
            [tenantId,row.mapping_id,target,observed,observationStartedAt,matchesAttempt?(differs?'pending':'confirmed'):'requires_reconciliation']);
          if(!matchesAttempt)return null;
          await tx.query("UPDATE ci_outbox SET status='done',lease_until=NULL,last_error=NULL,remote_attempt_started_at=NULL WHERE tenant_id=$1 AND id=$2 AND status='held'",[tenantId,uncertain.id]);
          await tx.query(`UPDATE ci_outbox SET status='pending',available_at=now(),last_error=NULL
            WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' AND status='held' AND remote_attempt_started_at IS NULL`,[tenantId,row.mapping_id]);
          if(differs)await tx.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4) ON CONFLICT DO NOTHING",[tenantId,row.account_id,row.mapping_id,JSON.stringify({source:'shopify_uncertain_resolved',balanceVersion:balance.version,observedAt:new Date().toISOString()})]);
          return differs;
        }
        const observation=await tx.query("INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,observed_quantity,observed_at,publish_state,updated_at) VALUES($1,$2,$3,$4,$6,$5,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET target_quantity=EXCLUDED.target_quantity,observed_quantity=EXCLUDED.observed_quantity,observed_at=EXCLUDED.observed_at,publish_state=EXCLUDED.publish_state,updated_at=now() WHERE ci_channel_stock.observed_at IS NULL OR ci_channel_stock.observed_at<=EXCLUDED.observed_at RETURNING mapping_id",[tenantId,row.mapping_id,target,observed,differs?'pending':'confirmed',observationStartedAt]);
        if(!observation.rowCount)return null;
        if(differs)await tx.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4)",[tenantId,row.account_id,row.mapping_id,JSON.stringify({source:'shopify_reconcile',balanceVersion:balance.version,observedAt:new Date().toISOString()})]);
        return differs;
      });
      if(mismatch!==null){summary.checked++;if(mismatch)summary.mismatched++;await tryLogSyncAttempt({tenantId,accountId:row.account_id,direction:'inbound',operation:'shopify_readback',skuCount:1,diagnostic:{mappingId:row.mapping_id,observed,mismatch}});}
      });
    }catch(error){const safe=await safeAccountFailure(tenantId,row.account_id,error);summary.errors.push({mappingId:row.mapping_id,error:safe.message});await tryLogSyncAttempt({tenantId,accountId:row.account_id,direction:'inbound',operation:'shopify_readback',status:'failed',diagnostic:safe});}
  }
  return summary;
}

export async function reconcileWooUncertainStock(tenantId,{fetcher}={}){
  const db=inventoryPool();
  const rows=await readReconciliationPage(db,`SELECT o.id AS task_id,o.remote_target_quantity,m.id AS mapping_id,m.listing_id,m.external_sku,
      m.account_id,a.* FROM ci_outbox o
    JOIN ci_channel_mapping m ON m.tenant_id=o.tenant_id AND m.id=o.mapping_id
    JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
    WHERE o.tenant_id=$1 AND o.task_type='publish_stock' AND o.status='held'
      AND o.remote_attempt_started_at IS NOT NULL AND m.active=true AND a.status='active'
      AND a.platform='woocommerce'`,tenantId,'woocommerce','task');
  const summary={checked:0,resolved:0,requiresReconciliation:0,unavailable:0,errors:[]};
  for(const row of rows){
    try{
      await withStockMappingLock(db,tenantId,row.mapping_id,async()=>{
      if(!/^\d+(\/variations\/\d+)?$/.test(row.listing_id))throw new Error('Invalid WooCommerce product/variation mapping');
      const secret=await currentCredentials(row);
      if(secret.locationPlugin)throw new Error('WooCommerce location plugin is not supported');
      await acquireAccountQuota({tenantId,accountId:row.account_id,cost:1,rate:2,burst:5});
      const readStartedAt=new Date();
      const product=await wooRequest(secret,`/products/${row.listing_id}`,{fetcher});
      if(product.sku!==row.external_sku||product.manage_stock!==true||!Number.isSafeInteger(product.stock_quantity)||product.stock_quantity<0){summary.unavailable++;return;}
      const observed=product.stock_quantity;
      const result=await transaction(async tx=>{
        const current=(await tx.query(`SELECT o.id,o.remote_target_quantity,m.pack_size,b.*
          FROM ci_outbox o JOIN ci_channel_mapping m ON m.tenant_id=o.tenant_id AND m.id=o.mapping_id
          JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id
          WHERE o.tenant_id=$1 AND o.id=$2 AND o.status='held' AND o.remote_attempt_started_at IS NOT NULL
            AND m.active=true FOR UPDATE OF o,b`,[tenantId,row.task_id])).rows[0];
        if(!current)return null;
        const available=Math.max(0,Number(current.on_hand)-Number(current.reserved_order)-Number(current.reserved_cart)-Number(current.damaged)-Number(current.quarantined)-Number(current.safety_stock));
        const target=Math.floor(available/current.pack_size);
        const matchesAttempt=observed===Number(current.remote_target_quantity);
        await tx.query(`UPDATE ci_outbox SET readback_quantity=$3,readback_at=$4,publication_state=$5,reconciliation_result=$6
          WHERE tenant_id=$1 AND id=$2 AND status='held'`,
          [tenantId,row.task_id,observed,readStartedAt,matchesAttempt?'RECONCILED':'MISMATCH',matchesAttempt?'MATCHED_ATTEMPT':'READBACK_MISMATCH']);
        await tx.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,readback_quantity,readback_at,publish_state,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET
          target_quantity=EXCLUDED.target_quantity,readback_quantity=EXCLUDED.readback_quantity,
          readback_at=EXCLUDED.readback_at,publish_state=EXCLUDED.publish_state,updated_at=now()`,
          [tenantId,row.mapping_id,target,observed,readStartedAt,matchesAttempt?(target===observed?'confirmed':'pending'):'requires_reconciliation']);
        if(!matchesAttempt)return 'mismatch';
        await tx.query("UPDATE ci_outbox SET status='done',lease_until=NULL,last_error=NULL,remote_attempt_started_at=NULL WHERE tenant_id=$1 AND id=$2",[tenantId,row.task_id]);
        await tx.query(`UPDATE ci_outbox SET status='pending',available_at=now(),last_error=NULL
          WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' AND status='held'
            AND remote_attempt_started_at IS NULL`,[tenantId,row.mapping_id]);
        if(target!==observed)await tx.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4)",
          [tenantId,row.account_id,row.mapping_id,JSON.stringify({source:'woo_uncertain_resolved',balanceVersion:current.version,observedAt:readStartedAt.toISOString()})]);
        return 'resolved';
      });
      if(result){summary.checked++;if(result==='resolved')summary.resolved++;else summary.requiresReconciliation++;}
      });
    }catch(error){const safe=await safeAccountFailure(tenantId,row.account_id,error);summary.errors.push({mappingId:row.mapping_id,error:safe.message});}
  }
  return summary;
}

export async function reconcileAmazonUncertainStock(tenantId,{fetcher}={}){
  const db=inventoryPool();
  const rows=await readReconciliationPage(db,`SELECT o.id AS task_id,m.id AS mapping_id,m.external_sku,m.external_location_id,m.account_id,a.*
    FROM ci_outbox o JOIN ci_channel_mapping m ON m.tenant_id=o.tenant_id AND m.id=o.mapping_id
    JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
    WHERE o.tenant_id=$1 AND o.task_type='publish_stock' AND o.status='held'
      AND o.remote_attempt_started_at IS NOT NULL AND m.active=true AND a.status='active'
      AND a.platform='amazon'`,tenantId,'amazon','task');
  const summary={checked:0,resolved:0,requiresReconciliation:0,errors:[]};
  for(const row of rows){
    try{
      await withStockMappingLock(db,tenantId,row.mapping_id,async()=>{
      const secret=await currentCredentials(row);
      const connector=new AmazonConnector({...secret,fetcher,sellerId:secret.sellerId||row.external_account_id,
        marketplaceId:secret.marketplaceId||row.settings.marketplaceId,endpoint:amazonOrigins[secret.region]||undefined,
        rateControl:cost=>acquireAccountQuota({tenantId,accountId:row.account_id,cost,rate:5,burst:10})});
      const readStartedAt=new Date();
      const fulfillmentChannelCode=String(row.external_location_id||'').trim();
      if(!fulfillmentChannelCode)throw new Error('Amazon MFN mapping has no approved fulfillment channel code');
      const observed=await connector.getMfnQuantity({sellerSku:row.external_sku,fulfillmentChannelCode});
      const result=await transaction(async tx=>{
        const current=(await tx.query(`SELECT o.id,o.remote_target_quantity,m.pack_size,b.*
          FROM ci_outbox o JOIN ci_channel_mapping m ON m.tenant_id=o.tenant_id AND m.id=o.mapping_id
          JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
          JOIN ci_inventory_balance b ON b.tenant_id=m.tenant_id AND b.master_sku_id=m.master_sku_id AND b.location_id=m.internal_location_id
          WHERE o.tenant_id=$1 AND o.id=$2 AND o.status='held' AND o.remote_attempt_started_at IS NOT NULL
            AND m.active=true AND a.status='active' AND a.platform='amazon' FOR UPDATE OF o,b`,[tenantId,row.task_id])).rows[0];
        if(!current)return null;
        const available=Math.max(0,Number(current.on_hand)-Number(current.reserved_order)-Number(current.reserved_cart)-Number(current.damaged)-Number(current.quarantined)-Number(current.safety_stock));
        const target=Math.floor(available/current.pack_size);
        const matchesAttempt=observed===Number(current.remote_target_quantity);
        await tx.query(`UPDATE ci_outbox SET readback_quantity=$3,readback_at=$4,publication_state=$5,reconciliation_result=$6
          WHERE tenant_id=$1 AND id=$2 AND status='held'`,
          [tenantId,row.task_id,observed,readStartedAt,matchesAttempt?'RECONCILED':'MISMATCH',matchesAttempt?'MATCHED_ATTEMPT':'READBACK_MISMATCH']);
        await tx.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,readback_quantity,readback_at,publish_state,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET
          target_quantity=EXCLUDED.target_quantity,readback_quantity=EXCLUDED.readback_quantity,
          readback_at=EXCLUDED.readback_at,publish_state=EXCLUDED.publish_state,updated_at=now()`,
          [tenantId,row.mapping_id,target,observed,readStartedAt,matchesAttempt?(target===observed?'confirmed':'pending'):'requires_reconciliation']);
        if(!matchesAttempt)return 'mismatch';
        await tx.query("UPDATE ci_outbox SET status='done',lease_until=NULL,last_error=NULL,remote_attempt_started_at=NULL WHERE tenant_id=$1 AND id=$2",[tenantId,row.task_id]);
        await tx.query(`UPDATE ci_outbox SET status='pending',available_at=now(),last_error=NULL
          WHERE tenant_id=$1 AND mapping_id=$2 AND task_type='publish_stock' AND status='held'
            AND remote_attempt_started_at IS NULL`,[tenantId,row.mapping_id]);
        if(target!==observed)await tx.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4)",
          [tenantId,row.account_id,row.mapping_id,JSON.stringify({source:'amazon_uncertain_resolved',balanceVersion:current.version,observedAt:readStartedAt.toISOString()})]);
        return 'resolved';
      });
      if(result){summary.checked++;if(result==='resolved')summary.resolved++;else summary.requiresReconciliation++;}
      });
    }catch(error){const safe=await safeAccountFailure(tenantId,row.account_id,error);summary.errors.push({mappingId:row.mapping_id,error:safe.message});}
  }
  return summary;
}
