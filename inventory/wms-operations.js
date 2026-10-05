import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { applyInventoryEventInTransaction } from './ledger.js';

const text = value => String(value ?? '').trim();
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function physicalQuantity(value){
  if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim()))throw failure('A numeric whole stock quantity is required.');
  return Number(value);
}

function tenant() {
  const value = text(process.env.INVENTORY_ALLOWED_TENANT_ID);
  if (!value) throw failure('Central Inventory tenant is not configured.', 503);
  return value;
}

export async function listCentralWmsStock() {
  const tenantId = tenant();
  const result = await inventoryPool().query(`
    SELECT s.id AS master_sku_id,l.id AS location_id,s.sku AS sku_code,s.product_name AS name,l.code AS warehouse,
      b.on_hand,(b.on_hand-b.reserved_order-b.reserved_cart-b.damaged-b.quarantined-b.safety_stock) AS available,
      b.reserved_order+b.reserved_cart AS reserved
    FROM ci_inventory_balance b
    JOIN ci_master_sku s ON s.tenant_id=b.tenant_id AND s.id=b.master_sku_id
    JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id
    WHERE b.tenant_id=$1 AND l.location_type IN ('warehouse','store')
    ORDER BY s.sku,l.code`, [tenantId]);
  return result.rows.map(row => ({ ...row, id: `${row.master_sku_id}:${row.location_id}`, available: Math.max(0, Number(row.available)) }));
}

export async function centralSkuExists(skuCode) {
  const result = await inventoryPool().query(
    'SELECT 1 FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2',
    [tenant(), text(skuCode)],
  );
  return result.rowCount === 1;
}

async function resolvePhysicalPair(db, tenantId, skuCode, fromCode, toCode) {
  const result = await db.query(`
    SELECT s.id AS master_sku_id,s.sku,l.id AS location_id,l.code,l.location_type
    FROM ci_master_sku s CROSS JOIN ci_location l
    WHERE s.tenant_id=$1 AND s.sku=$2 AND l.tenant_id=$1 AND l.code=ANY($3::text[])
      AND l.location_type IN ('warehouse','store')`, [tenantId, skuCode, [fromCode, toCode]]);
  const sku = result.rows.find(row => row.sku === skuCode);
  const from = result.rows.find(row => row.code === fromCode);
  const to = result.rows.find(row => row.code === toCode);
  if (!sku || !from || !to) throw failure('SKU and both physical locations must have exact Central Inventory mappings.', 409);
  if (from.location_id === to.location_id) throw failure('Source and destination Central Inventory locations must differ.', 400);
  return { masterSkuId: sku.master_sku_id, fromLocationId: from.location_id, toLocationId: to.location_id };
}

export async function transferCentralWmsStock(input) {
  const tenantId = tenant();
  const skuCode = text(input.skuCode), fromCode = text(input.fromCode), toCode = text(input.toCode);
  const quantity = physicalQuantity(input.quantity), requestId = text(input.requestId), reason = text(input.reason);
  if (!skuCode || !fromCode || !toCode || !Number.isSafeInteger(quantity) || quantity <= 0 || !requestId || requestId.length > 120) {
    throw failure('SKU, source, destination, positive whole quantity, and request ID are required.');
  }
  const { operation = 'move' } = input;
  const externalReference = JSON.stringify({ requestId, operation, reason, fromCode, toCode });
  return transaction(async db => {
    const mapping = await resolvePhysicalPair(db, tenantId, skuCode, fromCode, toCode);
    const out = await applyInventoryEventInTransaction(db, {
      tenantId, masterSkuId: mapping.masterSkuId, locationId: mapping.fromLocationId,
      eventKey: `wms-transfer:${requestId}:out`, eventType: 'wms_transfer_out', source: 'wms_location_move',
      externalReference, delta_on_hand: -quantity,
    });
    const into = await applyInventoryEventInTransaction(db, {
      tenantId, masterSkuId: mapping.masterSkuId, locationId: mapping.toLocationId,
      eventKey: `wms-transfer:${requestId}:in`, eventType: 'wms_transfer_in', source: 'wms_location_move',
      externalReference, delta_on_hand: quantity,
    });
    return { duplicate: out.duplicate && into.duplicate, eventIds: [out.eventId, into.eventId], quantity, skuCode, fromCode, toCode };
  });
}

export async function adjustCentralWmsStock(input) {
  const tenantId = tenant();
  const masterSkuId = text(input.masterSkuId), locationId = text(input.locationId);
  const quantity = physicalQuantity(input.quantity), reason = text(input.reason), requestId = text(input.requestId);
  if (!masterSkuId || !locationId || !Number.isSafeInteger(quantity) || quantity === 0 || !reason || reason.length > 250 || !requestId || requestId.length > 120) {
    throw failure('Central SKU, location, non-zero whole quantity, reason, and request ID are required.');
  }
  return transaction(async db => {
    const identity = await db.query(`SELECT 1 FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id
      WHERE s.tenant_id=$1 AND s.id=$2 AND l.id=$3 AND l.location_type IN ('warehouse','store')`, [tenantId, masterSkuId, locationId]);
    if (identity.rowCount !== 1) throw failure('Central Inventory SKU or physical location not found.', 409);
    return applyInventoryEventInTransaction(db, {
      tenantId, masterSkuId, locationId, eventKey: `wms-adjustment:${requestId}`,
      eventType: 'wms_adjustment', source: 'wms_adjustment', externalReference: JSON.stringify({ requestId, reason }),
      delta_on_hand: quantity,
    });
  });
}

export async function receiveCentralInboundStock(input) {
  const tenantId = tenant();
  const requestId = text(input.requestId), locationCode = text(input.locationCode);
  const inboundNo = text(input.inboundNo), poNo = text(input.poNo);
  if (!/^[A-Za-z0-9-]{1,120}$/.test(requestId) || !locationCode || !inboundNo || !poNo || !Array.isArray(input.lines) || !input.lines.length) {
    throw failure('Inbound number, PO, physical location, request ID, and received lines are required.');
  }
  const quantities = new Map();
  for (const line of input.lines) {
    const skuCode = text(line.skuCode), quantity = Number(line.quantity);
    if (!skuCode || !Number.isSafeInteger(quantity) || quantity <= 0) throw failure('Each inbound SKU needs a positive whole received quantity.');
    const total = (quantities.get(skuCode) || 0) + quantity;
    if (!Number.isSafeInteger(total)) throw failure('Combined inbound quantity exceeds the supported whole-number range.');
    quantities.set(skuCode, total);
  }
  const requestedSkus = [...quantities.keys()].sort();
  const prefix = `wms-inbound:${requestId}:`;
  const result = await (input.transactionRunner || transaction)(async db => {
    const locks = [`wms-inbound-po:${tenantId}:${poNo}`, prefix].sort();
    for (const lock of locks) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lock]);
    const existing = await db.query(`SELECT event_key FROM ci_inventory_event WHERE tenant_id=$1 AND left(event_key,length($2))=$2`, [tenantId, prefix]);
    const mapped = await db.query(`
      SELECT s.id AS master_sku_id,s.sku,l.id AS location_id
      FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id
      WHERE s.tenant_id=$1 AND s.sku=ANY($2::text[]) AND l.code=$3 AND l.location_type IN ('warehouse','store')`,
    [tenantId, requestedSkus, locationCode]);
    const skuIds = new Map(mapped.rows.map(row => [row.sku, row.master_sku_id]));
    if (skuIds.size !== requestedSkus.length || mapped.rows.length !== requestedSkus.length) {
      throw Object.assign(failure('Every inbound SKU and the selected physical location must have an exact Central Inventory mapping.', 409), { safeToEdit: existing.rowCount === 0 });
    }
    const canonicalLines = requestedSkus.map(skuCode => ({ skuCode, masterSkuId: skuIds.get(skuCode), quantity: quantities.get(skuCode) }));
    const payloadDigest = createHash('sha256').update(JSON.stringify({ locationCode, poNo, inboundNo, lines: canonicalLines })).digest('hex');
    const eventKeys = canonicalLines.map(line => `wms-inbound:${requestId}:${line.masterSkuId}`);
    if (existing.rowCount) {
      const priorKeys = existing.rows.map(row => row.event_key).sort();
      if (priorKeys.length !== eventKeys.length || priorKeys.some((key, index) => key !== [...eventKeys].sort()[index])) {
        throw failure('Inbound request ID was already used for a different receipt.', 409);
      }
    }
    if (!existing.rowCount && input.allowedQuantities) {
      const prior = await db.query(`
        SELECT master_sku_id,COALESCE(SUM(delta_on_hand),0)::bigint AS received
        FROM ci_inventory_event
        WHERE tenant_id=$1 AND source=ANY($2::text[]) AND event_type='inbound_receipt'
          AND external_reference::jsonb->>'poNo'=$3 AND master_sku_id=ANY($4::uuid[])
        GROUP BY master_sku_id`, [tenantId, ['wms_inbound_create_edit', 'wms_inbound_realtime'], poNo, canonicalLines.map(line => line.masterSkuId)]);
      const received = new Map(prior.rows.map(row => [String(row.master_sku_id), Number(row.received)]));
      for (const line of canonicalLines) {
        const limit = Number(input.allowedQuantities.get(line.skuCode));
        if (!Number.isSafeInteger(limit) || limit < line.quantity || (received.get(String(line.masterSkuId)) || 0) + line.quantity > limit) {
          throw Object.assign(failure(`Received quantity for ${line.skuCode} exceeds the remaining PO quantity.`, 409), { safeToEdit: true });
        }
      }
    }
    const externalReference = JSON.stringify({ requestId, inboundNo, poNo, locationCode, payloadDigest });
    const events = [];
    try {
      if (!existing.rowCount && typeof input.validate === 'function') await input.validate();
      for (const line of canonicalLines) {
        events.push(await applyInventoryEventInTransaction(db, {
          tenantId, masterSkuId: line.masterSkuId, locationId: mapped.rows.find(row => row.sku === line.skuCode).location_id,
          eventKey: `wms-inbound:${requestId}:${line.masterSkuId}`, eventType: 'inbound_receipt',
          source: text(input.source) || 'wms_inbound_create_edit', externalReference, delta_on_hand: line.quantity,
        }));
      }
      return { duplicate: events.every(event => event.duplicate), eventIds: events.map(event => event.eventId), payloadDigest };
    } catch (error) {
      if (!existing.rowCount) error.safeToEdit = true;
      throw error;
    }
  });
  if (typeof input.finalize === 'function') result.finalizedRow = await input.finalize(result);
  return result;
}

// A Mongo GRN marked committed is a claim about PostgreSQL, not permission to
// post stock again. Verify that claim through the exact request's ledger rows.
export async function verifyCommittedCentralInboundStock(input) {
  const tenantId = tenant();
  const requestId = text(input.requestId), poNo = text(input.poNo);
  const inboundNo = text(input.inboundNo), locationCode = text(input.locationCode);
  const eventIds = input.eventIds;
  if (!/^[A-Za-z0-9-]{1,120}$/.test(requestId) || !poNo || !inboundNo || !locationCode
    || !Array.isArray(input.lines) || !input.lines.length || !Array.isArray(eventIds)) {
    throw failure('Committed inbound receipt identity is incomplete. Reconcile it before retrying.', 409);
  }
  const expected = new Map();
  for (const line of input.lines) {
    const skuCode = text(line.skuCode), quantity = Number(line.quantity);
    if (!skuCode || !Number.isSafeInteger(quantity) || quantity <= 0) throw failure('Committed inbound quantities are invalid.', 409);
    const total = (expected.get(skuCode) || 0) + quantity;
    if (!Number.isSafeInteger(total)) throw failure('Committed inbound quantity exceeds the supported range.', 409);
    expected.set(skuCode, total);
  }
  if (eventIds.length !== expected.size || new Set(eventIds).size !== eventIds.length
    || eventIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) {
    throw failure('Committed inbound event IDs do not match its SKU lines. Reconcile before retrying.', 409);
  }
  const prefix = `wms-inbound:${requestId}:`;
  const { rows } = await inventoryPool().query(`
    SELECT e.id,e.event_key,e.event_type,e.source,e.external_reference,e.delta_on_hand,
      s.sku,l.code AS location_code,b.master_sku_id AS balance_sku_id
    FROM ci_inventory_event e
    JOIN ci_master_sku s ON s.tenant_id=e.tenant_id AND s.id=e.master_sku_id
    JOIN ci_location l ON l.tenant_id=e.tenant_id AND l.id=e.location_id
    LEFT JOIN ci_inventory_balance b ON b.tenant_id=e.tenant_id AND b.master_sku_id=e.master_sku_id AND b.location_id=e.location_id
    WHERE e.tenant_id=$1 AND left(e.event_key,length($2))=$2`, [tenantId, prefix]);
  if (rows.length !== expected.size || rows.some(row => !eventIds.includes(row.id)
    || row.event_type !== 'inbound_receipt' || !['wms_inbound_create_edit', 'wms_inbound_realtime'].includes(row.source)
    || row.location_code !== locationCode || !row.balance_sku_id
    || expected.get(row.sku) !== Number(row.delta_on_hand))) {
    throw failure('Committed inbound does not reconcile with its Central Inventory events. No stock was posted; investigate before retrying.', 409);
  }
  for (const row of rows) {
    let reference;
    try { reference = JSON.parse(row.external_reference); } catch { throw failure('Committed inbound event reference is invalid. Reconcile before retrying.', 409); }
    if (reference.requestId !== requestId || reference.poNo !== poNo || reference.inboundNo !== inboundNo
      || reference.locationCode !== locationCode) {
      throw failure('Committed inbound event reference differs from the GRN. Reconcile before retrying.', 409);
    }
  }
  return { duplicate: true, eventIds };
}

export async function listCentralWmsMoveHistory(filters = {}) {
  const tenantId = tenant();
  const query = value => text(value) === '-1' ? '' : text(value);
  const values = [tenantId, query(filters.skuCode), query(filters.siteLocationCode), query(filters.reason), query(filters.fromDate), query(filters.toDate)];
  const result = await inventoryPool().query(`
    SELECT e.id,e.event_key,e.external_reference,e.delta_on_hand,e.created_at,s.sku,s.product_name,l.code AS location
    FROM ci_inventory_event e
    JOIN ci_master_sku s ON s.tenant_id=e.tenant_id AND s.id=e.master_sku_id
    JOIN ci_location l ON l.tenant_id=e.tenant_id AND l.id=e.location_id
    WHERE e.tenant_id=$1 AND e.source='wms_location_move' AND e.event_type='wms_transfer_out'
      AND ($2='' OR s.sku ILIKE '%'||$2||'%') AND ($3='' OR l.code ILIKE '%'||$3||'%')
      AND ($4='' OR e.external_reference::jsonb->>'reason' ILIKE '%'||$4||'%')
      AND ($5='' OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $5::date)
      AND ($6='' OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $6::date)
    ORDER BY e.created_at ${filters.sord === 'asc' ? 'ASC' : 'DESC'}`, values);
  return result.rows.map(row => {
    let details = {};
    try { details = JSON.parse(row.external_reference || '{}'); } catch {}
    return { id: row.id, skuCode: row.sku, SKUDesc: row.product_name, moveDate: row.created_at,
      siteLocation: details.fromCode || row.location, siteLocationCode: details.fromCode || row.location, moveQty: Math.abs(Number(row.delta_on_hand)),
      putawayNo: '', remarks: details.toCode ? `Transfer from ${details.fromCode} to ${details.toCode}` : '', reason: details.reason || '',
      fromZone: '', toZone: '',
      fromBin: '', toBin: '', lpn: '', user: '', cycleId: '' };
  });
}
