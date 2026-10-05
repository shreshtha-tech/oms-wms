import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { findOne, insert, transitionGrnReceipt } = await import('../api/mongo.js');
const { transitionGrnDraft } = await import('../api/inbound-receipt-guard.js');
const createEdit = (await import('../api/inbound-create-edit.js')).default;
const realtime = (await import('../api/inbound-realtime.js')).default;
const manageAsn = (await import('../api/manage-asn.js')).default;
const invoke = async (handler, body, method = 'POST') => {
  const response = { code: 200, setHeader() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body }, response);
  return response;
};

await insert('purchase_orders', {
  po_no: 'PO-CLAIM', status: 'Released', warehouse: 'CLAIM-WH', vendor: 'Claim Vendor',
  line_items: [{ sku_code: 'CLAIM-SKU', qty: 8 }],
});
await insert('generic_records', { module: 'location', location_code: 'CLAIM-WH', location_name: 'Claim Warehouse', status: 'Active' });

const draft = await insert('grn', { po_no: 'PO-CLAIM', inbound_no: 'INB-CLAIM', grn_no: 'INB-CLAIM', status: 'Pending Confirmation', lines: [] });
const old = await findOne('grn', { id: draft.id });
const claims = await Promise.all([
  transitionGrnReceipt(draft.id, old, { status: 'Central Receipt Pending', central_receipt_status: 'pending', central_request_id: 'claim-a' }),
  transitionGrnReceipt(draft.id, old, { status: 'Central Receipt Pending', central_receipt_status: 'pending', central_request_id: 'claim-b' }),
]);
assert.equal(claims.filter(Boolean).length, 1);

const racedDraft = await insert('grn', { po_no: 'PO-CLAIM', inbound_no: 'INB-EDIT-RACE', grn_no: 'INB-EDIT-RACE',
  status: 'Pending Confirmation', draft_revision: 1, lines: [] });
const racedSnapshot = await findOne('grn', { id: racedDraft.id });
const editAndStage = await Promise.all([
  transitionGrnDraft(racedSnapshot, { status: 'Pending Confirmation', lines: [{ skuCode: 'CLAIM-SKU', rcvdQty: 3 }] }),
  transitionGrnDraft(racedSnapshot, { status: 'Central Receipt Pending', central_receipt_status: 'pending', central_request_id: 'edit-race-stage' }),
]);
assert.equal(editAndStage.filter(Boolean).length, 1, 'An edit and receipt stage cannot both claim the same draft revision');
assert.equal((await findOne('grn', { id: racedDraft.id })).draft_revision, 2);

const spoofedGrn = await invoke(manageAsn, { asn_type: '4', po_no: 'PO-CLAIM', operation: '4',
  grn_no: 'GRN-FROM-ASN', lines: [{ sku_code: 'CLAIM-SKU', exp_qty: 2 }] });
assert.equal(spoofedGrn.code, 400, 'ASN creation cannot supply a GRN receipt number');
assert.equal(await findOne('grn', { grn_no: 'GRN-FROM-ASN' }), null);
const asnCreated = await invoke(manageAsn, { asn_type: '4', po_no: 'PO-CLAIM', operation: '1',
  lines: [{ sku_code: 'CLAIM-SKU', exp_qty: 2 }] });
assert.equal(asnCreated.code, 201);
const asnSaved = await invoke(manageAsn, { id: asnCreated.body.id, row_version: 1, asn_type: '4', po_no: 'PO-CLAIM',
  operation: '4', lines: [{ sku_code: 'CLAIM-SKU', exp_qty: 2 }] }, 'PUT');
assert.equal(asnSaved.code, 200, 'A pure ASN remains editable through Manage ASN');
assert.equal(asnSaved.body.draft_revision, 1);
const linkedAsn = await insert('grn', { asn_no: 'ASN-LEGACY-LINK', grn_no: 'GRN-LEGACY-LINK',
  po_no: 'PO-CLAIM', status: 'Confirmed', row_version: 1, lines: [{ sku_code: 'CLAIM-SKU', exp_qty: 2 }] });
assert.equal((await invoke(manageAsn, { id: linkedAsn.id, row_version: 1 }, 'PUT')).code, 409,
  'A historical ASN with a GRN number needs reconciliation before editing');
assert.equal((await invoke(createEdit, { action: 'confirm', id: asnCreated.body.id, poNo: 'PO-CLAIM', warehouse: 'CLAIM-WH',
  requestId: 'asn-not-inbound', lines: [{ skuCode: 'CLAIM-SKU', rcvdUOMQty: 2 }] })).code, 409);
assert.equal((await invoke(realtime, { action: 'confirm', id: asnCreated.body.id, inboundType: 'With PO', poNo: 'PO-CLAIM',
  warehouse: 'CLAIM-WH', requestId: 'asn-not-inbound-rt', lines: [{ skuCode: 'CLAIM-SKU', rcvdQty: 2 }] })).code, 409);

const cancelled = await insert('grn', { po_no: 'PO-CLAIM', inbound_no: 'INB-CANCELLED', grn_no: 'INB-CANCELLED',
  status: 'Cancelled', draft_revision: 1, lines: [{ skuCode: 'CLAIM-SKU', rcvdQty: 2 }] });
assert.equal((await invoke(createEdit, { action: 'save', id: cancelled.id, poNo: 'PO-CLAIM', warehouse: 'CLAIM-WH',
  lines: [{ skuCode: 'CLAIM-SKU', rcvdUOMQty: 2 }] })).code, 409);
assert.equal((await invoke(createEdit, { action: 'confirm', id: cancelled.id, poNo: 'PO-CLAIM', warehouse: 'CLAIM-WH',
  requestId: 'cancelled-create-edit', lines: [{ skuCode: 'CLAIM-SKU', rcvdUOMQty: 2 }] })).code, 409);
assert.equal((await invoke(realtime, { action: 'save', id: cancelled.id, inboundType: 'With PO', poNo: 'PO-CLAIM',
  warehouse: 'CLAIM-WH', lines: [{ skuCode: 'CLAIM-SKU', rcvdQty: 2 }] })).code, 409);
assert.equal((await findOne('grn', { id: cancelled.id })).status, 'Cancelled');

const second = await insert('grn', { po_no: 'PO-CLAIM', inbound_no: 'INB-CLAIM-2', grn_no: 'INB-CLAIM-2', status: 'Pending Confirmation', lines: [] });
const common = { action: 'confirm', id: second.id, poNo: 'PO-CLAIM', warehouse: 'CLAIM-WH' };
const savedConsoleError = console.error;
console.error = () => {};
try {
  const responses = await Promise.all([
    invoke(createEdit, { ...common, requestId: 'claim-create-edit', lines: [{ skuCode: 'CLAIM-SKU', rcvdUOMQty: 2 }] }),
    invoke(realtime, { ...common, inboundType: 'With PO', requestId: 'claim-realtime', lines: [{ skuCode: 'CLAIM-SKU', rcvdQty: 2 }] }),
  ]);
  assert.deepEqual(responses.map(row => row.code).sort(), [409, 503]);
  const staged = await findOne('grn', { id: second.id });
  assert.equal(staged.central_receipt_status, 'pending');
  assert.ok(['claim-create-edit', 'claim-realtime'].includes(staged.central_request_id));
  assert.equal((await invoke(manageAsn, { id: second.id, row_version: 0 }, 'PUT')).code, 409,
    'Manage ASN cannot overwrite an inbound receipt');
} finally {
  console.error = savedConsoleError;
}

console.log('PASS isolated GRN claim, edit-versus-stage revision race, ASN boundary, and receipt overwrite guard');
