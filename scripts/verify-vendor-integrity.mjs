import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../env.js';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for this persistence test.');
const configuredDb = process.env.MONGODB_DB || 'd_mills_global';
const testDb = `codexqa_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
if (testDb === configuredDb || Buffer.byteLength(testDb) > 38) throw new Error('Unsafe test database name.');
process.env.MONGODB_DB = testDb;
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
let created = false;
let failed = false;
try {
  const store = await import('../api/mongo.js');
  assert.equal(await store.waitForDataReady(), 'mongo');
  created = true;
  const handler = (await import('../api/vendors.js')).default;
  const call = async (method, body = {}, user = { username: 'qa-vendor-actor' }) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, setHeader() {} };
    await handler({ method, body, user }, res);
    return res;
  };
  const createdVendor = await call('POST', { vendor_code: 'QA-VENDOR', vendor_name: 'Original Supplier' });
  assert.equal(createdVendor.statusCode, 201);
  const id = createdVendor.payload.id;
  assert.equal(createdVendor.payload.audit[0].by, 'qa-vendor-actor');
  await store.insert('purchase_orders', { po_no: 'QA-PO', vendor_code: 'QA-VENDOR', vendor: 'Original Supplier' });
  await store.insert('grn', { grn_no: 'QA-GRN', vendor_code: 'QA-VENDOR', vendor: 'Original Supplier' });
  const updated = await call('PUT', { id, vendor_name: 'Renamed Supplier', vendor_code: 'FORGED', audit: [{ by: 'FORGED' }] });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.payload.vendor_name, 'Renamed Supplier');
  assert.equal(updated.payload.vendor_code, 'QA-VENDOR');
  assert.deepEqual(updated.payload.audit.map((entry) => entry.by), ['qa-vendor-actor', 'qa-vendor-actor']);
  await client.connect();
  const db = client.db(testDb);
  assert.equal((await db.collection('vendors').findOne({ id })).vendor_name, 'Renamed Supplier');
  assert.equal((await db.collection('purchase_orders').findOne({ po_no: 'QA-PO' })).vendor, 'Original Supplier');
  assert.equal((await db.collection('grn').findOne({ grn_no: 'QA-GRN' })).vendor, 'Original Supplier');
  assert.equal((await call('POST', { vendor_code: 'QA-VENDOR', vendor_name: 'Duplicate' })).statusCode, 409);
  console.log('PASS isolated MongoDB vendor create, rename, audit actor, immutable code, duplicate guard, and PO/GRN historical names.');
} catch (error) {
  failed = true;
  console.error('Vendor integrity test failed:', error.code || error.name || 'TEST_FAILURE');
} finally {
  if (created) {
    try {
      await client.connect();
      await client.db(testDb).dropDatabase();
      console.log('Isolated MongoDB test database removed.');
    } catch (error) {
      failed = true;
      console.error('Vendor integrity cleanup failed:', error.code || error.name || 'CLEANUP_FAILURE');
    }
  }
  await client.close();
  process.exit(failed ? 1 : 0);
}
