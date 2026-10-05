import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const handler = (await import('../api/ars.js')).default;

const invoke = async (method, entity, body = {}, path = '/api/ars') => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader() {},
  };
  await handler({ method, path, query: { entity }, body: { entity, ...body }, headers: {} }, res);
  return res;
};

await insert('generic_records', { module: 'location', code: 'ARS-GUARD-LOC', name: 'ARS Guard Location', status: 'Active' });
const rules = [];
for (const method of ['Min-Max', 'Sales History']) {
  rules.push(await insert('ars_rules', {
    rule_id: `GUARD-${method}`, ars_method: method, status: 'Active',
    location: 'ARS-GUARD-LOC', locations: ['ARS-GUARD-LOC'],
    sku_sets: [{ type: 'SKU', operand: 'Include', value: 'GUARD-SKU' }],
    description: 'Guard rule', vendor_type: 'Primary', output_type: 'Pending',
    start_date: new Date().toISOString().slice(0, 10),
    minimum_qty: 5, maximum_qty: 10, last_run_date: '',
  }));
}
for (const rule of rules) {
  const response = await invoke('PUT', 'rules', { action: 'run', id: rule.id });
  assert.equal(response.statusCode, 501);
  assert.match(response.payload.error, /durable request key/i);
}
assert.equal((await find('purchase_orders')).length, 0);
assert.equal((await find('ars_execution_logs')).length, 0);
for (const rule of rules) assert.equal((await find('ars_rules', { id: rule.id }))[0].last_run_date, '');
const edited = await invoke('PUT', 'rules', { id: rules[0].id, description: 'Updated guard rule', last_run_date: '2099-01-01', next_run_date: '2099-02-01' });
assert.equal(edited.statusCode, 200);
assert.equal(edited.payload.description, 'Updated guard rule');
assert.equal(edited.payload.last_run_date, '');
assert.equal(edited.payload.next_run_date ?? '', '');

const exportResponse = await invoke('POST', 'links', {}, '/api/downloadArsAttribute');
assert.equal(exportResponse.statusCode, 501);
assert.equal((await find('downloads')).length, 0);

const log = await insert('ars_execution_logs', {
  execution_id: 'GUARD-LOG', status: 'Document Generated',
  execution_details: [{ sku_code: 'GUARD-SKU', status: 'Document Created' }],
});
for (const action of ['approve-all', 'process-all']) {
  const response = await invoke('POST', 'logs', { action, id: log.id });
  assert.equal(response.statusCode, 501);
}
assert.equal((await invoke('PUT', 'logs', { id: log.id, status: 'Approved' })).statusCode, 501);
assert.equal((await invoke('DELETE', 'logs', { id: log.id })).statusCode, 501);
const saved = (await find('ars_execution_logs', { id: log.id }))[0];
assert.equal(saved.status, 'Document Generated');
assert.equal(saved.execution_details[0].status, 'Document Created');
console.log('PASS ARS: run cannot create duplicate or sales-history-derived POs; fake export and log processing create no records or status changes.');
