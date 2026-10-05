import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

process.env.MONGODB_URI = '';
const { inventoryPool, migrateInventory } = await import('../inventory/db.js');
const { receiveCentralInboundStock, verifyCommittedCentralInboundStock } = await import('../inventory/wms-operations.js');
const { insert, update } = await import('../api/mongo.js');
const createEdit = (await import('../api/inbound-create-edit.js')).default;
const realtime = (await import('../api/inbound-realtime.js')).default;

const tenant = `inbound-replay-${randomUUID()}`;
process.env.INVENTORY_ALLOWED_TENANT_ID = tenant;
const db = inventoryPool();
const skuId = randomUUID(), locationId = randomUUID();
const skuCode = 'REPLAY-SKU', poNo = 'PO-REPLAY', locationCode = 'REPLAY-WH';
const requestId = 'replay-committed-1', inboundNo = 'INB-REPLAY-1';
const lines = [{ skuCode, quantity: 2 }];
const fingerprint = createHash('sha256').update(JSON.stringify({ poNo, locationCode, lines })).digest('hex');

const invoke = async (handler, body) => {
  const response = { code: 200, setHeader() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method: 'POST', body }, response);
  return response;
};
const eventCount = async () => Number((await db.query('SELECT count(*)::integer AS count FROM ci_inventory_event WHERE tenant_id=$1', [tenant])).rows[0].count);

try {
  await migrateInventory();
  await db.query('INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,$3,$4)', [skuId,tenant,skuCode,'Replay item']);
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,$3,'warehouse')", [locationId,tenant,locationCode]);
  await insert('purchase_orders', { po_no: poNo, status: 'Released', vendor: 'Replay Vendor', warehouse: locationCode,
    line_items: [{ sku_code: skuCode, qty: 4 }] });
  await insert('generic_records', { module: 'location', location_code: locationCode, location_name: locationCode, status: 'Active' });
  const receipt = await receiveCentralInboundStock({ requestId, inboundNo, poNo, locationCode, lines });
  assert.equal(receipt.duplicate, false);
  assert.equal(await eventCount(), 1);
  await verifyCommittedCentralInboundStock({ requestId, inboundNo, poNo, locationCode, lines, eventIds: receipt.eventIds });
  await assert.rejects(() => verifyCommittedCentralInboundStock({ requestId, inboundNo, poNo, locationCode,
    lines: [{ skuCode, quantity: 3 }], eventIds: receipt.eventIds }), /does not reconcile/);

  const committed = await insert('grn', { inbound_no: inboundNo, grn_no: inboundNo, po_no: poNo,
    status: 'Confirmed', central_receipt_status: 'committed', central_request_id: requestId,
    central_receipt_fingerprint: fingerprint, central_receipt_event_ids: receipt.eventIds,
    lines: [{ skuCode, rcvdQty: 2, rcvdUOMQty: 2 }] });
  const common = { action: 'confirm', id: committed.id, poNo, warehouse: locationCode, requestId,
    lines: [{ skuCode, rcvdQty: 2, rcvdUOMQty: 2 }] };
  const createReplay = await invoke(createEdit, common);
  assert.equal(createReplay.code, 200, JSON.stringify(createReplay.body));
  const realtimeReplay = await invoke(realtime, { ...common, inboundType: 'With PO' });
  assert.equal(realtimeReplay.code, 200, JSON.stringify(realtimeReplay.body));
  assert.equal(await eventCount(), 1);
  const legacyFingerprint = createHash('sha256').update(JSON.stringify({ poNo, locationCode, received: lines })).digest('hex');
  await update('grn', committed.id, { central_receipt_fingerprint: legacyFingerprint });
  assert.equal((await invoke(createEdit, common)).code, 200);
  assert.equal((await invoke(realtime, { ...common, inboundType: 'With PO' })).code, 200);
  const { findOne } = await import('../api/mongo.js');
  const po = await findOne('purchase_orders', { po_no: poNo });
  await update('purchase_orders', po.id, { status: 'Closed' });
  assert.equal((await invoke(createEdit, common)).code, 200, 'A committed receipt stays replayable after PO closure');
  assert.equal((await invoke(realtime, { ...common, inboundType: 'With PO' })).code, 200);
  assert.equal(await eventCount(), 1);

  const missingRequestId = 'replay-missing-1';
  const missing = await insert('grn', { inbound_no: 'INB-MISSING-1', grn_no: 'INB-MISSING-1', po_no: poNo,
    status: 'Confirmed', central_receipt_status: 'committed', central_request_id: missingRequestId,
    central_receipt_fingerprint: fingerprint, central_receipt_event_ids: [randomUUID()],
    lines: [{ skuCode, rcvdQty: 2, rcvdUOMQty: 2 }] });
  const missingBody = { ...common, id: missing.id, requestId: missingRequestId };
  const savedConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal((await invoke(createEdit, missingBody)).code, 409);
    assert.equal((await invoke(realtime, { ...missingBody, inboundType: 'With PO' })).code, 409);
  } finally { console.error = savedConsoleError; }
  assert.equal(await eventCount(), 1, 'A false Mongo committed marker must never mint a physical receipt');
  console.log('PASS committed GRN replay reads ledger; missing ledger event fails closed without new stock');
} finally {
  await db.end();
}
