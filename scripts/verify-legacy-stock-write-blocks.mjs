import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const fulfillment = (await import('../api/fulfillment.js')).default;
const orderAllocation = (await import('../api/order-allocation.js')).default;
const cycleCount = (await import('../api/cycle-count.js')).default;
const bulkLottables = (await import('../api/bulk-lottables.js')).default;
const stoEditor = (await import('../api/sto-editor.js')).default;
const transfers = (await import('../api/transfers.js')).default;
const ars = (await import('../api/ars.js')).default;
const skuGrading = (await import('../api/sku-grading.js')).default;
const returns = (await import('../api/returns.js')).default;
const vendorReturnEditor = (await import('../api/vendor-return-editor.js')).default;
const amazonMfn = (await import('../api/amazon-mfn.js')).default;
const ajio = (await import('../api/ajio.js')).default;

const invoke = async (handler, method, body = {}, query = {}) => {
  const res = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await handler({ method, body, query, headers: {} }, res);
  return res;
};

const stock = await insert('inventory', { sku_code: 'SAFE-SKU', warehouse: 'SAFE-WH', bin: 'BIN-A', lpn: 'SAFE-LPN', available: 8, reserved: 2, on_hand: 10 });
const order = await insert('fulfillment_orders', { order_no: 'SAFE-ORDER', sku_code: stock.sku_code, warehouse: stock.warehouse, qty: 3, status: 'Confirmed' });
const sto = await insert('stock_transfers', { transfer_no: 'SAFE-STO', status: 'Pending', sku_code: stock.sku_code, qty: 2 });
await insert('generic_records', { module: 'location', code: 'SAFE-STO-FROM', name: 'Safe STO Source', status: 'Active' });
await insert('generic_records', { module: 'location', code: 'SAFE-STO-TO', name: 'Safe STO Destination', status: 'Active' });
const stoDraft = await invoke(stoEditor, 'POST', { action: 'save', orderType: '14', fromSiteLoc: 'SAFE-STO-FROM', toSiteLoc: 'SAFE-STO-TO', reasonCode: '20', priority: '1', lines: [{ id: 1, sku: stock.sku_code, orderQtyVal: 2, unitPriceVal: 1 }] });
assert.equal(stoDraft.statusCode, 201, 'STO metadata draft can be saved');
assert.equal(stoDraft.payload.status, 'Pending');
assert.equal(stoDraft.payload.lines[0].orderQtyVal, 2);
for (const [action, expected] of [['allocate', 501], ['unallocate', 501]]) {
  const response = await invoke(fulfillment, 'PUT', { action, ids: [order.id] });
  assert.equal(response.statusCode, expected);
}
assert.equal((await invoke(fulfillment, 'PUT', { ids: [order.id], status: 'Allocated' })).statusCode, 501);
for (const action of ['allocate', 'unAllocate']) {
  assert.equal((await invoke(orderAllocation, 'PUT', { action, ids: [order.id] })).statusCode, 501);
}

const count = await insert('generic_records', { module: 'cycle-count', code: 'SAFE-CC', status: 'WIP', status_code: 1 });
const cycleMeta = await invoke(cycleCount, 'GET');
assert.deepEqual(cycleMeta.payload.bins, []);
assert.deepEqual(cycleMeta.payload.lpns, []);
assert.equal(cycleMeta.payload.available, false);
assert.equal((await invoke(cycleCount, 'POST', { action: 'create', type: '1', bin: 'BIN-A' })).statusCode, 501);
assert.equal((await invoke(cycleCount, 'POST', { action: 'confirm', ids: [count.id] })).statusCode, 501);
assert.equal((await invoke(cycleCount, 'POST', { action: 'post', ids: [count.id] })).statusCode, 501);
assert.equal((await find('generic_records', { id: count.id }))[0].status, 'WIP');
assert.equal((await invoke(bulkLottables, 'POST', { action: 'import', rows: [{ skuCode: stock.sku_code, lotCode: 'LOT-A' }] })).statusCode, 501);
const gradingMeta = await invoke(skuGrading, 'GET');
assert.equal(gradingMeta.payload.available, false);
assert.deepEqual(gradingMeta.payload.inventory, []);
assert.equal((await invoke(skuGrading, 'POST', { action: 'create-line', inboundNo: 'INB-1', fromSku: stock.sku_code, toSku: 'SAFE-GRADE' })).statusCode, 501);
assert.equal((await invoke(skuGrading, 'POST', { action: 'confirm', gradeId: 'SAFE-GRADE' })).statusCode, 501);
for (const action of ['confirm', 'allocate', 'quick-ship', 'close', 'import']) {
  assert.equal((await invoke(stoEditor, 'POST', { action, stoNo: 'SAFE-STO', rows: [{ sku: stock.sku_code }] })).statusCode, 501);
}
const legacyConfirmedSto = await insert('stock_transfers', { transfer_no: 'SAFE-STO-CONFIRMED', status: 'Confirmed', sku_code: stock.sku_code, qty: 2 });
assert.equal((await invoke(stoEditor, 'POST', { action: 'cancel', stoNo: 'SAFE-STO-CONFIRMED' })).statusCode, 501);
assert.equal((await invoke(stoEditor, 'PUT', { action: 'save', stoNo: 'SAFE-STO-CONFIRMED', orderType: '14', fromSiteLoc: 'SAFE-STO-FROM', toSiteLoc: 'SAFE-STO-TO', reasonCode: '20', priority: '1', lines: [{ id: 1, sku: stock.sku_code, orderQtyVal: 3, unitPriceVal: 1 }] })).statusCode, 501, 'Legacy confirmed transfer must not be edited without the Central Inventory lifecycle');
const cancellableSto = await insert('stock_transfers', { transfer_no: 'SAFE-STO-DRAFT', status: 'Pending', sku_code: stock.sku_code, qty: 2 });
assert.equal((await invoke(stoEditor, 'POST', { action: 'cancel', stoNo: 'SAFE-STO-DRAFT' })).statusCode, 200);
assert.equal((await find('stock_transfers', { id: cancellableSto.id }))[0].status, 'Cancelled');
for (const method of ['POST', 'PUT', 'DELETE']) {
  assert.equal((await invoke(transfers, method, { id: sto.id, status: 'Shipped complete' })).statusCode, 501,
    `Legacy /api/transfers ${method} must not create or alter stock transfer lifecycle records`);
}
assert.equal((await find('stock_transfers', { id: legacyConfirmedSto.id }))[0].status, 'Confirmed');
assert.equal((await invoke(amazonMfn, 'POST', { action: 'pull-orders' })).statusCode, 503);
assert.equal((await invoke(amazonMfn, 'POST', { action: 'process-label' })).statusCode, 503);
assert.equal((await invoke(ajio, 'POST', { action: 'pull-backorders' })).statusCode, 503);
assert.equal((await invoke(ajio, 'POST', { action: 'generate-picklist' })).statusCode, 503);

const unchangedStock = (await find('inventory', { id: stock.id }))[0];
assert.equal(unchangedStock.available, 8);
assert.equal(unchangedStock.reserved, 2);
assert.equal(unchangedStock.on_hand, 10);
assert.equal((await find('fulfillment_orders', { id: order.id }))[0].status, 'Confirmed');
assert.equal((await find('stock_transfers', { id: sto.id }))[0].status, 'Pending');
assert.equal((await find('stock_transfers', { id: stoDraft.payload.id }))[0].status, 'Pending');

await insert('generic_records', { module: 'location', code: 'SAFE-WH', name: 'Safe Warehouse', status: 'Active' });
await insert('ars_settings', { enable_ars: true });
await insert('ars_sku_links', { sku_code: stock.sku_code, location: 'SAFE-WH', ars_flag: 'Active', stock_cover_days: 10 });
const rule = await insert('ars_rules', {
  rule_id: 'SAFE-ARS', status: 'Active', location: 'SAFE-WH', locations: ['SAFE-WH'],
  start_date: new Date().toISOString().slice(0, 10), ars_method: 'Min-Max', minimum_qty: 12,
  maximum_qty: 20, sku_sets: [{ type: 'SKU', operand: 'Include', value: stock.sku_code }],
  vendor_type: 'Primary', output_type: 'Pending', frequency: 6, description: 'Central stock guard',
});
const arsRun = await invoke(ars, 'PUT', { entity: 'rules', action: 'run', id: rule.id }, { entity: 'rules' });
assert.equal(arsRun.statusCode, 501, 'ARS runs must fail closed until idempotent purchase-order creation and authoritative sales-history calculation are connected');
assert.equal((await find('purchase_orders')).length, 0, 'ARS must not generate POs from legacy Mongo availability');
assert.equal((await invoke(returns, 'GET', {}, { entity: 'lookups' })).statusCode, 503, 'Return SKU lookups must fail closed without Central Inventory');
assert.equal((await invoke(vendorReturnEditor, 'GET')).statusCode, 503, 'Vendor return SKU lookups must fail closed without Central Inventory');
assert.equal((await invoke(stoEditor, 'POST', { action: 'sku-search', skuCode: stock.sku_code })).statusCode, 503, 'STO availability search must fail closed without Central Inventory');

console.log('PASS legacy order allocation, STO confirmation/allocation/shipping/closure/import, generic transfer writes, cycle-count and SKU-grading actions, lottable imports, and marketplace reservations fail closed against Mongo-only stock');
