import assert from 'node:assert/strict';
delete process.env.MONGODB_URI;
delete process.env.MONGODB_DB;
process.env.NODE_ENV = 'test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { default: handler } = await import('../api/inbound-create-edit.js');
const { default: realtime } = await import('../api/inbound-realtime.js');
const { insert, find } = await import('../api/mongo.js');
await insert('purchase_orders', { po_no: 'OWNED-IMPORT', line_items: [{ sku_code: 'OWNED-SKU', qty: 10 }] });
const before = await find('purchase_orders');
async function invoke(rows) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', body: { action: 'import', poNo: 'OWNED-IMPORT', rows }, headers: {} }, response);
  return response;
}
for (const row of [null, false, 7, 'row', []]) assert.equal((await invoke([row])).code, 400);
for (const quantity of [true, false, [1], { value: 1 }, '', ' ', 1.5, -1]) {
  const result = await invoke([{ sku_code: 'OWNED-SKU', qty: quantity }]);
  assert.equal(result.code, 200);
  assert.equal(result.body.successItems, 0);
  assert.equal(result.body.failedItems, 1);
}
for (const quantity of [1, '1']) assert.equal((await invoke([{ sku_code: 'OWNED-SKU', qty: quantity }])).body.successItems, 1);
async function invokeReceipt(handler, body) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', body, headers: {} }, response);
  return response;
}
for (const action of ['save', 'confirm']) {
  for (const quantity of [true, [1], { value: 1 }, ' ']) {
    const common = { action, poNo: 'OWNED-IMPORT', inboundType: 'With PO' };
    assert.equal((await invokeReceipt(handler, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdUOMQty: quantity }] })).code, 400);
    assert.equal((await invokeReceipt(realtime, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdQty: quantity }] })).code, 400);
  }
  for (const malformed of [null, [], false]) {
    const body = { action, poNo: 'OWNED-IMPORT', inboundType: 'With PO', lines: [malformed] };
    assert.equal((await invokeReceipt(handler, body)).code, 400);
    assert.equal((await invokeReceipt(realtime, body)).code, 400);
  }
}
assert.equal((await invokeReceipt(realtime, { action: 'scan', skuCode: 'OWNED-SKU', binLoc: 'BIN', qty: true })).code, 400);
await insert('skus', { sku_code: 'OWNED-SKU', barcode: 'OWNED-BARCODE', product_name: 'Owned product' });
const scanned = await invokeReceipt(realtime, { action: 'scan', skuCode: 'OWNED-BARCODE', sku_code: 'FORGED', product_name: 'Forged product', binLoc: ' BIN ', qty: 2, rcvdQty: 999 });
assert.equal(scanned.code, 200);
assert.equal(scanned.body.row.skuCode, 'OWNED-SKU');
assert.equal(scanned.body.row.skuDesc, 'Owned product');
assert.equal(scanned.body.row.rcvdQty, 2);
assert.equal(scanned.body.row.binLoc, 'BIN');
assert.equal((await find('grn')).length, 0, 'Rejected quantities must not create a receipt');
const originalReceipt = await insert('grn', { po_no: 'OWNED-IMPORT', status: 'Pending Confirmation', received_qty: 7 });
for (const id of [true, false, [1], {}, null, -1, 1.5, '1e0', ' ', Number.MAX_SAFE_INTEGER + 1]) {
  for (const action of ['save', 'confirm']) {
    const common = { action, id, poNo: 'OWNED-IMPORT', inboundType: 'With PO' };
    assert.equal((await invokeReceipt(handler, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdUOMQty: 1 }] })).code, 400);
    assert.equal((await invokeReceipt(realtime, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdQty: 1 }] })).code, 400);
  }
}
const { isInboundRecordId } = await import('../api/inbound-quantity.js');
for (const id of [undefined, 0, '', 1, '1']) assert.equal(isInboundRecordId(id), true);
const { addInboundQuantities } = await import('../api/inbound-quantity.js');
assert.equal(addInboundQuantities(Number.MAX_SAFE_INTEGER - 1, '1'), Number.MAX_SAFE_INTEGER);
assert.throws(() => addInboundQuantities(Number.MAX_SAFE_INTEGER, 1), error => error.status === 400);
for (const action of ['save', 'confirm']) {
  const common = { action, poNo: 'OWNED-IMPORT', inboundType: 'With PO' };
  assert.equal((await invokeReceipt(handler, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdUOMQty: Number.MAX_SAFE_INTEGER }, { skuCode: 'OWNED-SKU', rcvdUOMQty: 1 }] })).code, 400);
  assert.equal((await invokeReceipt(realtime, { ...common, lines: [{ skuCode: 'OWNED-SKU', rcvdQty: Number.MAX_SAFE_INTEGER }, { skuCode: 'OWNED-SKU', rcvdQty: 1 }] })).code, 400);
}
assert.deepEqual(await find('purchase_orders'), before);
assert.deepEqual(await find('grn'), [originalReceipt], 'Rejected IDs must neither edit the existing receipt nor create another');
console.log('PASS: malformed row rejection, nonnumeric quantity rejection, numeric compatibility and no receipt/PO mutation');
