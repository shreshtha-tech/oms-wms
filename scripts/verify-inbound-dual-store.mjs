import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { receiveCentralInboundStock } from '../inventory/wms-operations.js';
import { closeDataStore, findOne, insert } from '../api/mongo.js';
import { transitionGrnDraft } from '../api/inbound-receipt-guard.js';
import createEdit from '../api/inbound-create-edit.js';
import realtime from '../api/inbound-realtime.js';
import manageAsn from '../api/manage-asn.js';

if (!/^codexqa_/.test(process.env.MONGODB_DB || '') || !/codexqa_/.test(process.env.INVENTORY_DATABASE_URL || '')) {
  throw new Error('Both databases must be generated test databases.');
}
const tenant = `dual-store-${randomUUID()}`;
process.env.INVENTORY_ALLOWED_TENANT_ID = tenant;
const db = inventoryPool();
const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const skuId = randomUUID(), locationId = randomUUID(), skuCode = 'DUAL-SKU', locationCode = 'DUAL-WH';
const call = async (handler, body, method = 'POST') => {
  const response = { code: 200, setHeader() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body }, response);
  return response;
};
const fingerprint = (poNo, lines) => createHash('sha256').update(JSON.stringify({ poNo, locationCode, lines })).digest('hex');
const state = async () => {
  const events = await db.query('SELECT event_key,delta_on_hand FROM ci_inventory_event WHERE tenant_id=$1 ORDER BY event_key', [tenant]);
  const balance = await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [tenant, skuId]);
  return { events: events.rows, onHand: Number(balance.rows[0]?.on_hand || 0) };
};

try {
  await migrateInventory();
  await mongo.connect();
  await db.query('INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,$3,$4)', [skuId, tenant, skuCode, 'Dual-store item']);
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,$3,'warehouse')", [locationId, tenant, locationCode]);
  await insert('generic_records', { module: 'location', location_code: locationCode, location_name: 'Dual warehouse', status: 'Active' });
  await insert('purchase_orders', { po_no: 'PO-DUAL', status: 'Released', warehouse: locationCode, vendor: 'Dual vendor',
    line_items: [{ sku_code: skuCode, qty: 5 }] });
  const spoofedAsnGrn = await call(manageAsn, { asn_type: '4', po_no: 'PO-DUAL', operation: '4',
    grn_no: 'GRN-FROM-ASN', lines: [{ sku_code: skuCode, exp_qty: 2 }] });
  assert.equal(spoofedAsnGrn.code, 400, 'ASN creation must not accept a GRN receipt number');
  assert.equal(await mongo.db(process.env.MONGODB_DB).collection('grn').countDocuments({ grn_no: 'GRN-FROM-ASN' }), 0);
  const spoofedStatus = await call(realtime, { action: 'save', inboundType: 'With PO', poNo: 'PO-DUAL',
    warehouse: locationCode, status: 'Confirmed', lines: [{ skuCode, rcvdQty: 2 }] });
  assert.equal(spoofedStatus.code, 409, 'A draft save must not claim a committed receipt');
  assert.equal(await mongo.db(process.env.MONGODB_DB).collection('grn').countDocuments(), 0);
  assert.deepEqual(await state(), { events: [], onHand: 0 });
  const draft = await insert('grn', { inbound_no: 'INB-DUAL', grn_no: 'INB-DUAL', po_no: 'PO-DUAL', status: 'Pending Confirmation', lines: [] });
  const common = { action: 'confirm', id: draft.id, poNo: 'PO-DUAL', warehouse: locationCode };
  const createBody = { ...common, requestId: 'dual-create', invoiceNo: 'INV-DUAL-CREATE',
    lines: [{ skuCode, rcvdUOMQty: 2 }] };
  const realtimeBody = { ...common, inboundType: 'With PO', requestId: 'dual-realtime', invoiceNo: 'INV-DUAL-REALTIME',
    lines: [{ skuCode, rcvdQty: 2 }] };
  const responses = await Promise.all([call(createEdit, createBody), call(realtime, realtimeBody)]);
  assert.deepEqual(responses.map(item => item.code).sort(), [200, 409]);
  const saved = await mongo.db(process.env.MONGODB_DB).collection('grn').findOne({ id: draft.id });
  assert.equal(saved.status, 'Confirmed');
  assert.equal(saved.central_receipt_status, 'committed');
  assert.ok(['dual-create', 'dual-realtime'].includes(saved.central_request_id));
  assert.equal(saved.invoice_no, saved.central_request_id === 'dual-create' ? 'INV-DUAL-CREATE' : 'INV-DUAL-REALTIME');
  const committedInvoiceEdit = await call(realtime, { action: 'save-invoice', id: draft.id,
    inboundType: 'With PO', poNo: 'PO-DUAL', invoiceNo: 'INV-POST-COMMIT',
    lines: [{ skuCode, rcvdQty: 2 }] });
  assert.equal(committedInvoiceEdit.code, 409, 'A committed receipt invoice requires an authorized audited edit workflow');
  assert.equal((await findOne('grn', { id: draft.id })).invoice_no, saved.invoice_no);
  const first = await state();
  assert.equal(first.events.length, 1);
  assert.equal(first.onHand, 2);
  const winningHandler = saved.central_request_id === 'dual-create' ? createEdit : realtime;
  const winningBody = saved.central_request_id === 'dual-create' ? createBody : realtimeBody;
  assert.equal((await call(winningHandler, winningBody)).code, 200);
  assert.deepEqual(await state(), first);
  const indexes = await mongo.db(process.env.MONGODB_DB).collection('grn').listIndexes().toArray();
  assert.ok(indexes.some(index => index.name === 'uq_grn_central_request_id' && index.unique === true));
  await assert.rejects(() => insert('grn', { po_no: 'PO-DUAL', status: 'Central Receipt Pending', central_request_id: saved.central_request_id }),
    error => error.code === 11000);
  assert.equal((await call(manageAsn, { id: draft.id, row_version: 0 }, 'PUT')).code, 409,
    'Manage ASN must not change a committed inbound receipt');

  const editDraft = await insert('grn', { inbound_no: 'INB-EDIT-CAS', grn_no: 'INB-EDIT-CAS', po_no: 'PO-DUAL',
    status: 'Pending Confirmation', draft_revision: 1, lines: [] });
  const editSnapshot = await findOne('grn', { id: editDraft.id });
  const competing = await Promise.all([
    transitionGrnDraft(editSnapshot, { status: 'Pending Confirmation', lines: [{ skuCode, rcvdUOMQty: 1 }] }),
    transitionGrnDraft(editSnapshot, { status: 'Central Receipt Pending', central_receipt_status: 'pending',
      central_request_id: 'dual-edit-race' }),
  ]);
  assert.equal(competing.filter(Boolean).length, 1, 'Real MongoDB must grant the draft revision to one writer');
  assert.equal((await findOne('grn', { id: editDraft.id })).draft_revision, 2);

  await insert('purchase_orders', { po_no: 'PO-CRASH', status: 'Released', warehouse: locationCode, vendor: 'Dual vendor',
    line_items: [{ sku_code: skuCode, qty: 5 }] });
  const lines = [{ skuCode, quantity: 2 }], requestId = 'dual-crash', inboundNo = 'INB-CRASH';
  const pending = await insert('grn', { inbound_no: inboundNo, grn_no: inboundNo, po_no: 'PO-CRASH', status: 'Central Receipt Pending',
    central_receipt_status: 'pending', central_request_id: requestId, central_receipt_fingerprint: fingerprint('PO-CRASH', lines),
    invoice_no: 'INV-STAGED', remarks: 'Staged receipt metadata', received_qty: 2,
    lines: [{ skuCode, rcvdUOMQty: 2 }] });
  await assert.rejects(() => receiveCentralInboundStock({ requestId, inboundNo, poNo: 'PO-CRASH', locationCode, lines,
    source: 'wms_inbound_create_edit', finalize: async () => { throw new Error('Injected Mongo finalization failure'); } }),
  /Injected Mongo finalization failure/);
  assert.equal((await findOne('grn', { id: pending.id })).central_receipt_status, 'pending');
  assert.equal((await state()).events.length, 2, 'PostgreSQL committed before Mongo finalization failed');
  const retry = await call(createEdit, { action: 'confirm', id: pending.id, poNo: 'PO-CRASH', warehouse: locationCode,
    requestId, invoiceNo: 'INV-ALTERED', remarks: 'Changed retry metadata', lines: [{ skuCode, rcvdUOMQty: 2 }] });
  assert.equal(retry.code, 200, JSON.stringify(retry.body));
  const recoveredRow = await findOne('grn', { id: pending.id });
  assert.equal(recoveredRow.central_receipt_status, 'committed');
  assert.equal(recoveredRow.invoice_no, 'INV-STAGED', 'A retry must not replace the invoice recorded before ledger commit');
  assert.equal(recoveredRow.remarks, 'Staged receipt metadata', 'A retry must not replace staged remarks');
  assert.equal(retry.body.row.invoice_no, 'INV-STAGED', 'The retry response must show the persisted invoice');
  const recovered = await state();
  assert.equal(recovered.events.length, 2);
  assert.equal(recovered.onHand, 4);

  await insert('purchase_orders', { po_no: 'PO-KILL', status: 'Released', warehouse: locationCode, vendor: 'Dual vendor',
    line_items: [{ sku_code: skuCode, qty: 5 }] });
  const killed = await insert('grn', { inbound_no: 'INB-KILL', grn_no: 'INB-KILL', po_no: 'PO-KILL', status: 'Central Receipt Pending',
    central_receipt_status: 'pending', central_request_id: 'dual-kill', central_receipt_fingerprint: fingerprint('PO-KILL', lines),
    lines: [{ skuCode, rcvdUOMQty: 2 }] });
  const crashChild = spawn(process.execPath, ['scripts/inbound-receipt-crash-child.mjs'], {
    cwd: process.cwd(), env: { ...process.env, INVENTORY_ALLOWED_TENANT_ID: tenant }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const exited = new Promise(resolve => crashChild.once('exit', (code, signal) => resolve({ code, signal })));
  let childError = '';
  crashChild.stderr.on('data', chunk => { childError = (childError + String(chunk)).slice(-1000); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash child did not reach the post-commit boundary.')), 15000);
      crashChild.once('message', marker => { clearTimeout(timer); marker === 'pg-committed' ? resolve() : reject(new Error('Unexpected crash marker.')); });
      crashChild.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Crash child exited before marker: ${code ?? signal}; ${childError}`)); });
    });
    crashChild.kill('SIGKILL');
    const exit = await exited;
    assert.equal(exit.signal, 'SIGKILL');
  } finally {
    if (crashChild.exitCode === null && crashChild.signalCode === null) crashChild.kill('SIGKILL');
    await exited;
  }
  assert.equal((await findOne('grn', { id: killed.id })).central_receipt_status, 'pending');
  const afterKill = await state();
  assert.equal(afterKill.events.length, 3);
  assert.equal(afterKill.onHand, 6);
  const killedRetry = await call(createEdit, { action: 'confirm', id: killed.id, poNo: 'PO-KILL', warehouse: locationCode,
    requestId: 'dual-kill', lines: [{ skuCode, rcvdUOMQty: 2 }] });
  assert.equal(killedRetry.code, 200, JSON.stringify(killedRetry.body));
  assert.equal((await findOne('grn', { id: killed.id })).central_receipt_status, 'committed');
  assert.deepEqual(await state(), afterKill);

  await insert('purchase_orders', { po_no: 'PO-RT-CRASH', status: 'Released', warehouse: locationCode, vendor: 'Dual vendor',
    line_items: [{ sku_code: skuCode, qty: 5 }] });
  const realtimeRequestId = 'dual-rt-crash', realtimeInboundNo = 'INB-RT-CRASH';
  const realtimeLines = [{ skuCode, quantity: 1 }];
  const realtimePending = await insert('grn', { inbound_no: realtimeInboundNo, grn_no: realtimeInboundNo,
    po_no: 'PO-RT-CRASH', warehouse: locationCode, inbound_type: 'With PO', status: 'Central Receipt Pending',
    central_receipt_status: 'pending', central_request_id: realtimeRequestId,
    central_receipt_fingerprint: fingerprint('PO-RT-CRASH', realtimeLines),
    invoice_no: 'RT-INV-STAGED', remarks: 'Realtime staged metadata', received_qty: 1,
    lines: [{ skuCode, rcvdQty: 1 }] });
  await assert.rejects(() => receiveCentralInboundStock({ requestId: realtimeRequestId,
    inboundNo: realtimeInboundNo, poNo: 'PO-RT-CRASH', locationCode, lines: realtimeLines,
    source: 'wms_inbound_realtime', finalize: async () => { throw new Error('Injected realtime finalization failure'); } }),
  /Injected realtime finalization failure/);
  const beforeRealtimeRetry = await state();
  const realtimeRetry = await call(realtime, { action: 'confirm', id: realtimePending.id, inboundType: 'With PO',
    poNo: 'PO-RT-CRASH', warehouse: locationCode, requestId: realtimeRequestId,
    invoiceNo: 'RT-INV-ALTERED', remarks: 'Changed realtime retry', lines: [{ skuCode, rcvdQty: 1 }] });
  assert.equal(realtimeRetry.code, 200, JSON.stringify(realtimeRetry.body));
  const realtimeRecovered = await findOne('grn', { id: realtimePending.id });
  assert.equal(realtimeRecovered.central_receipt_status, 'committed');
  assert.equal(realtimeRecovered.invoice_no, 'RT-INV-STAGED');
  assert.equal(realtimeRecovered.remarks, 'Realtime staged metadata');
  assert.equal(realtimeRetry.body.row.invoice_no, 'RT-INV-STAGED', 'The realtime response must show the persisted invoice');
  assert.equal(realtimeRetry.body.row.invoiceNo, 'RT-INV-STAGED', 'The form must receive its displayed invoice field');
  assert.deepEqual(await state(), beforeRealtimeRetry, 'Realtime retry must not add a second ledger event');
  console.log('PASS real isolated MongoDB/PostgreSQL: status-spoof rejection, concurrent claim, draft edit CAS, ASN guard, metadata-preserving replay, unique request index, exception and process-kill recovery');
} finally {
  await closeDataStore();
  await mongo.close().catch(() => {});
  await db.end();
}
