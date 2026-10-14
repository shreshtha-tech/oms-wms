import { createHash } from 'node:crypto';
import { transaction } from './db.js';
import { evaluateStockAlert } from './alerts.js';

export class InventoryConflict extends Error {constructor(message){super(message);this.status=409;}}
const columns=['on_hand','reserved_order','reserved_cart','damaged','quarantined','safety_stock'];
const integer=(value)=>Number.isSafeInteger(value);
export function sellable(balance){return Math.max(0,Number(balance.on_hand)-Number(balance.reserved_order)-Number(balance.reserved_cart)-Number(balance.damaged)-Number(balance.quarantined)-Number(balance.safety_stock));}
export async function applyInventoryEvent(input){return transaction(db=>applyInventoryEventInTransaction(db,input));}
export async function applyInventoryEventInTransaction(db,input) {
  const {tenantId,masterSkuId,locationId,eventKey,eventType,source,externalReference=null,occurredAt=null}=input;
  if(![tenantId,masterSkuId,locationId,eventKey,eventType,source].every(x=>typeof x==='string'&&x.length>0))throw new TypeError('Event identity, SKU, location, type and source are required');
  const deltas=Object.fromEntries(columns.map(c=>{
    const supplied=input[`delta_${c}`];
    if(supplied!==undefined&&typeof supplied!=='number'&&(typeof supplied!=='string'||!supplied.trim()))throw new TypeError('Quantity deltas must be numeric scalars');
    return [c,Number(supplied===undefined?0:supplied)];
  }));
  if(!Object.values(deltas).every(integer))throw new TypeError('All quantity deltas must be safe integers');
  const reservation=input.reservation||null;
  if(reservation){const {action,orderId,lineId,quantity}=reservation;if(!['reserve','release','consume'].includes(action)||![orderId,lineId].every(x=>typeof x==='string'&&x)||!integer(quantity)||quantity<=0)throw new TypeError('Invalid reservation transition');if(deltas.reserved_order!==(action==='reserve'?quantity:-quantity)||deltas.on_hand!==(action==='consume'?-quantity:0))throw new TypeError('Reservation deltas do not match transition');}
  const canonical=JSON.stringify({tenantId,masterSkuId,locationId,eventKey,eventType,source,externalReference,occurredAt,deltas,reservation});
  const hash=createHash('sha256').update(canonical).digest('hex');
  return (async()=>{
    // Serialize changes across a SKU's locations so aggregate alerts see committed balances.
    await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,masterSkuId]);
    await db.query('INSERT INTO ci_inventory_balance(tenant_id,master_sku_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenantId,masterSkuId,locationId]);
    const current=await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 FOR UPDATE',[tenantId,masterSkuId,locationId]);
    const existing=await db.query('SELECT id,payload_hash FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=$2',[tenantId,eventKey]);
    if(existing.rowCount){if(existing.rows[0].payload_hash!==hash)throw new InventoryConflict('Event key replayed with different content');return {duplicate:true,eventId:existing.rows[0].id};}
    if(reservation){const {action,orderId,lineId,quantity}=reservation;const args=[tenantId,source,orderId,lineId];if(action==='reserve'){const prior=await db.query('SELECT id FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',args);if(prior.rowCount)throw new InventoryConflict('Order line already reserved');}else{const prior=await db.query('SELECT * FROM ci_reservation WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4 FOR UPDATE',args);if(prior.rowCount!==1||prior.rows[0].status!=='active'||Number(prior.rows[0].quantity)!==quantity)throw new InventoryConflict('Active reservation does not match');}}
    const stored=Object.fromEntries(columns.map(c=>[c,Number(current.rows[0][c])]));
    if(Object.values(stored).some(value=>!integer(value)||value<0))throw new InventoryConflict('Stored stock exceeds the supported integer range or is invalid; reconcile before mutation');
    const next=Object.fromEntries(columns.map(c=>[c,stored[c]+deltas[c]]));
    if(Object.values(next).some(x=>!integer(x)||x<0)||next.reserved_order+next.reserved_cart+next.damaged+next.quarantined+next.safety_stock>next.on_hand)throw new InventoryConflict('Insufficient or invalid stock');
    const event=await db.query('INSERT INTO ci_inventory_event(tenant_id,master_sku_id,location_id,event_key,event_type,source,external_reference,occurred_at,payload_hash,delta_on_hand,delta_reserved_order,delta_reserved_cart,delta_damaged,delta_quarantined,delta_safety_stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id',[tenantId,masterSkuId,locationId,eventKey,eventType,source,externalReference,occurredAt,hash,...columns.map(c=>deltas[c])]);
    if(reservation){const {action,orderId,lineId,quantity}=reservation;if(action==='reserve')await db.query("INSERT INTO ci_reservation(tenant_id,master_sku_id,location_id,source,external_order_id,external_line_id,quantity,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active')",[tenantId,masterSkuId,locationId,source,orderId,lineId,quantity]);else await db.query('UPDATE ci_reservation SET status=$5 WHERE tenant_id=$1 AND source=$2 AND external_order_id=$3 AND external_line_id=$4',[tenantId,source,orderId,lineId,action==='release'?'released':'consumed']);}
    await db.query('UPDATE ci_inventory_balance SET on_hand=$4,reserved_order=$5,reserved_cart=$6,damaged=$7,quarantined=$8,safety_stock=$9,version=version+1,updated_at=now() WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenantId,masterSkuId,locationId,...columns.map(c=>next[c])]);
    await evaluateStockAlert(db,tenantId,masterSkuId);
    const mappings=await db.query("SELECT m.id,m.account_id FROM ci_channel_mapping m JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id WHERE m.tenant_id=$1 AND m.master_sku_id=$2 AND m.internal_location_id=$3 AND m.active=true AND a.status='active' AND a.platform IN ('shopify','amazon','woocommerce')",[tenantId,masterSkuId,locationId]);
    for(const mapping of mappings.rows){await db.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4) ON CONFLICT DO NOTHING",[tenantId,mapping.account_id,mapping.id,JSON.stringify({eventId:event.rows[0].id})]);}
    return {duplicate:false,eventId:event.rows[0].id,balance:next,sellable:sellable(next)};
  })();
}
