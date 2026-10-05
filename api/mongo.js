// ============================================================================
//  Data layer — MongoDB or an explicitly unconfigured in-memory store.
//
//  If MONGODB_URI is set, all data is read/written to your MongoDB Atlas
//  cluster. The collection registry is empty for a clean installation.
//
//  If MONGODB_URI is NOT set, the app uses an empty in-memory store. A failed
//  configured connection must not silently accept non-persistent writes.
//
//  Every collection uses a numeric `id` field (auto-incremented) so the
//  frontend contract is identical to the previous backend.
// ============================================================================
import { createMongoConnection, databaseUnavailable } from './mongo-connection.js';
import { SEED } from './seed.js';
import { currentUser } from './auth-session.js';
import { persistenceRequired } from './storage-policy.js';
import { resolveMongoConfiguration } from './mongo-config.js';
import { mongoHealthPayload } from './mongo-health.js';

const URI = process.env.MONGODB_URI || '';
const mongoConfiguration = resolveMongoConfiguration();
const DB_NAME = mongoConfiguration.selectedDatabase;
console.info('[data] MongoDB selection', { selectedDatabase: DB_NAME, maskedHost: mongoConfiguration.maskedHost });
for (const warning of mongoConfiguration.warnings) {
  const message = warning === 'MONGODB_DB_UNSET_DEFAULT_USED'
    ? 'MONGODB_DB is unset; using the development default d_mills_global.'
    : 'MONGODB_DB overrides a different database path in MONGODB_URI; confirm the selected database deliberately.';
  console.warn('[data] MongoDB configuration warning', { code: warning, message, selectedDatabase: DB_NAME });
}
const COLLECTIONS = Object.keys(SEED);

let mode = URI || persistenceRequired() ? 'unavailable' : 'memory';
const connection = URI ? createMongoConnection({ uri: URI, database: DB_NAME }) : null;
let mongoClient = null;
let mem = null;
let memSeq = {};
let purchaseOrderIdentityIndex;

// ---- In-memory store ----
function initMemory() {
  if (mem) return;
  mem = {};
  memSeq = {};
  for (const c of COLLECTIONS) {
    mem[c] = SEED[c].map((row, i) => ({ id: i + 1, ...row }));
    memSeq[c] = SEED[c].length;
  }
}

// Connection recovery does not seed or modify business collections.
async function getDb() {
  if (!connection) throw databaseUnavailable();
  const db = await connection.connect();
  mongoClient = connection.client();
  mode = 'mongo';
  return db;
}
// Persistent domain effects never use the optional memory store.
export async function mongoDomainTransaction(operation) {
  const db = await getDb();
  const session = mongoClient.startSession();
  try { return await session.withTransaction(() => operation(db, session)); }
  finally { await session.endSession(); }
}
async function ensureReady() {
  if (connection) { await getDb(); return; }
  if (persistenceRequired()) throw Object.assign(databaseUnavailable(), { message: 'MONGODB_URI is required when persistent storage is enforced.' });
  initMemory();
}

async function nextId(db, c) {
  const top = await db.collection(c).find({}, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).toArray();
  await db.collection('_counters').updateOne({ _id: c }, { $max: { seq: Number(top[0]?.id) || 0 } }, { upsert: true });
  const r = await db.collection('_counters').findOneAndUpdate(
    { _id: c }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  const doc = r.value || r; // driver version differences
  return doc.seq;
}

// Start one bounded attempt; requests can retry after a failed startup.
void ensureReady().catch(() => {});

function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

// Simple equality-based matcher for memory mode.
function matches(row, query) {
  return Object.entries(query || {}).every(([k, v]) => row[k] === v);
}

// ---------------------------------------------------------------- public API
export function getMode() { return connection?.status().state === 'READY' ? 'mongo' : mode === 'memory' ? 'memory' : 'unavailable'; }
export function dataStoreStatus() { return connection?.status() || { database: 'mongodb', state: 'DISCONNECTED', optional: !persistenceRequired(), mode }; }
export function dataStoreConfiguration() { return { ...mongoConfiguration, warnings: [...mongoConfiguration.warnings] }; }
export async function dataStoreDataset() {
  const dataset = connection ? await connection.datasetStatus() : { datasetState: 'UNCONFIGURED', datasetEmpty: null };
  return mongoHealthPayload(dataStoreConfiguration(), dataStoreStatus(), dataset);
}
export async function closeDataStore() { if (connection) await connection.close(); mongoClient = null; mode = 'unavailable'; }
export async function waitForDataReady() { await ensureReady(); return getMode(); }
export async function probeDataStore() { await ensureReady(); if (connection) await connection.probe(); return getMode(); }
export function actor(req) { return currentUser(req)?.username || 'unknown'; }

async function findImpl(collection, query = {}, { sort, projection } = {}) {
  if (collection === 'products') collection = 'skus';
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    let cur = db.collection(collection).find(query);
    if (sort) cur = cur.sort(sort);
    if (projection) cur = cur.project(projection);
    const docs = await cur.toArray();
    return docs.map(stripId);
  }
  let rows = mem[collection].filter((r) => matches(r, query));
  if (sort) {
    const [field, dir] = Object.entries(sort)[0];
    rows = [...rows].sort((a, b) => (a[field] > b[field] ? 1 : -1) * dir);
  }
  return rows.map((r) => {
    const doc = { ...r };
    if (projection) {
      const included = Object.entries(projection).filter(([, value]) => value === 1).map(([key]) => key);
      if (included.length) {
        for (const key of Object.keys(doc)) if (!included.includes(key)) delete doc[key];
      } else {
        for (const [key, value] of Object.entries(projection)) if (value === 0) delete doc[key];
      }
    }
    return doc;
  });
}

async function findOneImpl(collection, query = {}) {
  const rows = await find(collection, query);
  return rows[0] || null;
}

async function ensureIndexImpl(collection, keys, options) {
  await ensureReady();
  if (mode !== 'mongo') return null;
  return (await getDb()).collection(collection).createIndex(keys, options);
}

async function insertImpl(collection, doc) {
  await ensureReady();
  if (collection === 'purchase_orders' && typeof doc.po_no === 'string') {
    if (mode === 'mongo') {
      purchaseOrderIdentityIndex ??= ensureIndexImpl('purchase_orders', { po_no: 1 }, { name: 'uq_purchase_order_number', unique: true, partialFilterExpression: { po_no: { $type: 'string' } } }).catch(error => {
        purchaseOrderIdentityIndex = null;
        if (error.code === 11000) throw Object.assign(new Error('Purchase order identity cannot be guaranteed. Reconcile existing duplicate order numbers before creating orders.'), { statusCode: 503 });
        throw error;
      });
      await purchaseOrderIdentityIndex;
    } else if (mem[collection].some(row => row.po_no === doc.po_no)) {
      throw Object.assign(new Error('Purchase Order number already exists.'), { code: 11000 });
    }
  }
  if (mode === 'mongo') {
    const db = await getDb();
    const id = await nextId(db, collection);
    const full = { id, ...doc };
    if (full.id == null) full.id = id;
    await db.collection(collection).insertOne(full);
    return stripId(full);
  }
  if (collection === 'skus' && mem[collection].some(row => String(row.sku_code).toLowerCase() === String(doc.sku_code).toLowerCase())) throw Object.assign(new Error('SKU Code already exists'), { code: 11000 });
  const id = ++memSeq[collection];
  const full = { id, ...doc };
  if (full.id == null) full.id = id;
  mem[collection].push(full);
  return { ...full };
}

async function insertCustomerImpl(doc) {
  await ensureReady();
  const db = mode === 'mongo' ? await getDb() : null;
  const id = db ? await nextId(db, 'partners') : ++memSeq.partners;
  const code = `CUS${String(id).padStart(3, '0')}`;
  const full = { ...doc, id, code, customer_code: code };
  if (db) { await db.collection('partners').insertOne(full); return stripId(full); }
  mem.partners.push(full);
  return { ...full };
}

// Vendor codes are immutable business identities. Enforce uniqueness at the
// write boundary rather than relying on a handler's read-before-write check.
async function insertVendorImpl(doc) {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    try {
      await db.collection('vendors').createIndex({ vendor_code: 1 }, { unique: true, name: 'vendors_code_unique' });
    } catch {
      throw Object.assign(new Error('Vendor uniqueness could not be established; creation is unavailable.'), { status: 503 });
    }
    try { return await insert('vendors', doc); }
    catch (error) {
      if (error.code === 11000) throw Object.assign(new Error('Vendor code already exists.'), { status: 409 });
      throw error;
    }
  }
  // No await between checking and writing in the in-memory store.
  if (mem.vendors.some(row => row.vendor_code === doc.vendor_code)) {
    throw Object.assign(new Error('Vendor code already exists.'), { status: 409 });
  }
  const full = { ...doc, id: ++memSeq.vendors };
  mem.vendors.push(full);
  return { ...full };
}

async function updateVendorWithAuditImpl(id, fields, auditEntry) {
  await ensureReady();
  const { audit: ignoredAudit, id: ignoredId, _id: ignoredMongoId, ...changes } = fields;
  if (mode === 'mongo') {
    const result = await (await getDb()).collection('vendors').findOneAndUpdate(
      { id, $or: [{ audit: { $type: 'array' } }, { audit: { $exists: false } }] },
      { $set: changes, $push: { audit: auditEntry } }, { returnDocument: 'after' },
    );
    const row = result?.value || result;
    if (row?.id == null) throw Object.assign(new Error('Vendor is missing or audit history requires repair.'), { status: 409 });
    return stripId(row);
  }
  const row = mem.vendors.find(vendor => vendor.id === id);
  if (!row || (row.audit !== undefined && !Array.isArray(row.audit))) {
    throw Object.assign(new Error('Vendor is missing or audit history requires repair.'), { status: 409 });
  }
  // Mutate fields and append history together, without yielding the event loop.
  Object.assign(row, changes, { audit: [...(row.audit || []), auditEntry] });
  return { ...row };
}

// Update by matching numeric id(s). ids can be a single id or an array.
async function updateImpl(collection, ids, fields) {
  await ensureReady();
  const list = Array.isArray(ids) ? ids : [ids];
  if (mode === 'mongo') {
    const db = await getDb();
    await db.collection(collection).updateMany({ id: { $in: list } }, { $set: fields });
    const docs = await db.collection(collection).find({ id: { $in: list } }).toArray();
    return docs.map(stripId);
  }
  const updated = [];
  mem[collection] = mem[collection].map((r) => {
    if (list.includes(r.id)) { const n = { ...r, ...fields }; updated.push(n); return n; }
    return r;
  });
  return updated.map((r) => ({ ...r }));
}

// Atomically move a GRN between receipt states. A stale handler must not
// replace a newer staged/committed request after a cross-database boundary.
async function transitionGrnReceiptImpl(id, expected, fields) {
  await ensureReady();
  const optionalExpected = ['draft_revision', 'row_version', 'asn_no', 'inbound_no']
    .filter(field => Object.prototype.hasOwnProperty.call(expected, field));
  const matchesExpected = row => row?.id === id
    && (row.status ?? null) === (expected.status ?? null)
    && (row.central_request_id ?? null) === (expected.central_request_id ?? null)
    && (row.central_receipt_status ?? null) === (expected.central_receipt_status ?? null)
    && optionalExpected.every(field => (row[field] ?? null) === (expected[field] ?? null));
  if (mode === 'mongo') {
    const optionalQuery = Object.fromEntries(optionalExpected.map(field => [field, expected[field] ?? null]));
    const result = await (await getDb()).collection('grn').findOneAndUpdate(
      { id, status: expected.status ?? null,
        central_request_id: expected.central_request_id ?? null,
        central_receipt_status: expected.central_receipt_status ?? null, ...optionalQuery },
      { $set: fields }, { returnDocument: 'after' },
    );
    const doc = result?.value || result;
    return doc?.id == null ? null : stripId(doc);
  }
  const row = mem.grn.find(matchesExpected);
  if (!row) return null;
  Object.assign(row, fields);
  return { ...row };
}

// Update rows matching an arbitrary query (used e.g. by GRN -> PO close).
async function updateWhereImpl(collection, query, fields) {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    await db.collection(collection).updateMany(query, { $set: fields });
    return;
  }
  mem[collection] = mem[collection].map((r) => (matches(r, query) ? { ...r, ...fields } : r));
}

// Atomically attach an SKU only while a seller listing is still unmapped.
// Missing and empty values are both treated as unmapped for legacy rows.
async function claimUnmappedSkuLinkImpl(id, fields) {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    const result = await db.collection('sku_channel_links').findOneAndUpdate(
      { id, eretail_sku: { $in: [null, ''] }, sku_code: { $in: [null, ''] } },
      { $set: fields },
      { returnDocument: 'after' },
    );
    const doc = result?.value || result;
    return doc?.id == null ? null : stripId(doc);
  }
  const row = mem.sku_channel_links.find((item) => item.id === id
    && (item.eretail_sku == null || item.eretail_sku === '')
    && (item.sku_code == null || item.sku_code === ''));
  if (!row) return null;
  Object.assign(row, fields);
  return { ...row };
}

// Compare-and-set a Customer's single group assignment. This prevents two
// concurrent Customer Group edits from assigning the same customer twice.
async function setCustomerGroupIfCurrentImpl(id, allowedGroupCodes, nextGroupCode) {
  await ensureReady();
  const allowed = [...new Set(allowedGroupCodes.map((value) => String(value ?? '')))];
  if (mode === 'mongo') {
    const db = await getDb();
    const currentAssignment = [{ customer_group_code: { $in: allowed } }];
    if (allowed.includes('')) currentAssignment.push({ customer_group_code: { $exists: false } });
    const result = await db.collection('partners').updateOne(
      { id: Number(id), type: 'Customer', $or: currentAssignment },
      { $set: { customer_group_code: nextGroupCode } },
    );
    return result.matchedCount === 1;
  }
  const index = mem.partners.findIndex((row) => row.id === Number(id) && row.type === 'Customer');
  if (index < 0 || !allowed.includes(String(mem.partners[index].customer_group_code ?? ''))) return false;
  mem.partners[index] = { ...mem.partners[index], customer_group_code: nextGroupCode };
  return true;
}

async function removeImpl(collection, id, expected = {}) {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    const result = await db.collection(collection).deleteOne({ ...expected, id });
    return Object.keys(expected).length ? { ok: true, deletedCount: result.deletedCount } : { ok: true };
  }
  const before = mem[collection].length;
  mem[collection] = mem[collection].filter((r) => r.id !== id || !matches(r, expected));
  return Object.keys(expected).length ? { ok: true, deletedCount: before - mem[collection].length } : { ok: true };
}

async function removeIfPresentImpl(collection, id) {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    return (await db.collection(collection).deleteOne({ id })).deletedCount === 1;
  }
  const index = mem[collection].findIndex(row => row.id === id);
  if (index < 0) return false;
  mem[collection].splice(index, 1);
  return true;
}

// CORS + JSON helper shared by all routes.
export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// Own the complete legacy Tax Group metadata/component write boundary.
async function saveTaxGroupImpl(id, fields, components) {
  await ensureReady();
  const validate = (groups, current, mappings, codes) => {
    if (id != null && !current) throw Object.assign(new Error('Tax Group not found'), { statusCode: 404 });
    if (groups.some(row => row.id !== id && String(row.code || '').trim().toLowerCase() === fields.code.toLowerCase())) throw Object.assign(new Error('Tax Group Code already exists.'), { statusCode: 409 });
    if (groups.some(row => row.id !== id && String(row.name || '').trim().toLowerCase() === fields.name.toLowerCase())) throw Object.assign(new Error('Tax Group Name already exists.'), { statusCode: 409 });
    const prior = new Set(mappings.map(row => row.tax_code_id));
    for (const component of components) {
      const code = codes.find(row => row.id === component.tax_code_id);
      if (!code) throw Object.assign(new Error('One or more Tax Codes are invalid.'), { statusCode: 400 });
      if (code.is_active !== 'Active' && !prior.has(code.id)) throw Object.assign(new Error('Inactive Tax Codes cannot be added to a Tax Group.'), { statusCode: 400 });
    }
  };
  if (mode === 'mongo') {
    const db = await getDb();
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw Object.assign(new Error('Tax Group changes require transactional MongoDB storage.'), { statusCode: 503 });
    const session = mongoClient.startSession();
    try {
      return await session.withTransaction(async () => {
        // Shared transaction-owned write serializes uniqueness and replacements
        // across processes; driver retries re-read all authoritative state.
        await db.collection('_counters').updateOne({ _id: 'tax_group_save_revision' }, { $inc: { seq: 1 } }, { upsert: true, session });
        const groups = await db.collection('generic_records').find({ module: 'tax-group' }, { session }).toArray();
        const current = groups.find(row => row.id === id);
        const mappings = id == null ? [] : await db.collection('tax_group_codes').find({ group_id: id }, { session }).toArray();
        const codes = await db.collection('tax_codes').find({}, { session }).toArray();
        validate(groups, current, mappings, codes);
        const allocate = async collection => {
          const result = await db.collection('_counters').findOneAndUpdate({ _id: collection }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
          return (result.value || result).seq;
        };
        const groupId = id ?? await allocate('generic_records');
        if (id == null) await db.collection('generic_records').insertOne({ ...fields, id: groupId }, { session });
        else await db.collection('generic_records').updateOne({ id, module: 'tax-group' }, { $set: fields }, { session });
        await db.collection('tax_group_codes').deleteMany({ group_id: groupId }, { session });
        for (const [index, component] of components.entries()) await db.collection('tax_group_codes').insertOne({ ...component, id: await allocate('tax_group_codes'), group_id: groupId, sequence: index + 1 }, { session });
        return groupId;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
  const groups = mem.generic_records.filter(row => row.module === 'tax-group');
  const current = groups.find(row => row.id === id);
  validate(groups, current, mem.tax_group_codes.filter(row => row.group_id === id), mem.tax_codes);
  const groupId = id ?? ++memSeq.generic_records;
  const replacement = components.map((component, index) => ({ ...component, id: ++memSeq.tax_group_codes, group_id: groupId, sequence: index + 1 }));
  if (current) Object.assign(current, fields);
  else mem.generic_records.push({ ...fields, id: groupId });
  mem.tax_group_codes = [...mem.tax_group_codes.filter(row => row.group_id !== groupId), ...replacement];
  return groupId;
}


async function readTaxGroupSnapshotImpl() {
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw Object.assign(new Error('Tax Group reads require snapshot-capable MongoDB storage.'), { statusCode: 503 });
    const session = mongoClient.startSession();
    try {
      return await session.withTransaction(async () => {
        const groups = await db.collection('generic_records').find({ module: 'tax-group' }, { session }).sort({ id: -1 }).toArray();
        const mappings = await db.collection('tax_group_codes').find({}, { session }).toArray();
        const codes = await db.collection('tax_codes').find({}, { session }).toArray();
        return [groups.map(stripId), mappings.map(stripId), codes.map(stripId)];
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
  return structuredClone([mem.generic_records.filter(row => row.module === 'tax-group').sort((a,b) => b.id-a.id), mem.tax_group_codes, mem.tax_codes]);
}

export const find = (...args) => connection ? connection.run(() => findImpl(...args)) : findImpl(...args);

export const findOne = (...args) => connection ? connection.run(() => findOneImpl(...args)) : findOneImpl(...args);

export const ensureIndex = (...args) => connection ? connection.run(() => ensureIndexImpl(...args)) : ensureIndexImpl(...args);

export const insert = (...args) => connection ? connection.run(() => insertImpl(...args)) : insertImpl(...args);

export const insertCustomer = (...args) => connection ? connection.run(() => insertCustomerImpl(...args)) : insertCustomerImpl(...args);

export const insertVendor = (...args) => connection ? connection.run(() => insertVendorImpl(...args)) : insertVendorImpl(...args);

export const updateVendorWithAudit = (...args) => connection ? connection.run(() => updateVendorWithAuditImpl(...args)) : updateVendorWithAuditImpl(...args);

export const update = (...args) => connection ? connection.run(() => updateImpl(...args)) : updateImpl(...args);

// Compare the observed admin version in the write itself; a separate handler
// precheck cannot prevent concurrent credential or permission replacements.
export async function updateAdminIfVersion(id, expectedVersion, fields) {
  const operation = async () => {
    await ensureReady();
    const version = (expectedVersion ?? 0) + 1;
    if (mode === 'mongo') {
      const result = await (await getDb()).collection('admin_records').findOneAndUpdate(
        {id, version:expectedVersion ?? null},
        {$set:{...fields,version}}, {returnDocument:'after'},
      );
      const doc = result?.value || result;
      return doc?.id == null ? null : stripId(doc);
    }
    const row = mem.admin_records.find(row=>row.id===id && (row.version ?? null)===(expectedVersion ?? null));
    if (!row) return null;
    Object.assign(row,fields,{version});
    return {...row};
  };
  return connection ? connection.run(operation) : operation();
}

export const transitionGrnReceipt = (...args) => connection ? connection.run(() => transitionGrnReceiptImpl(...args)) : transitionGrnReceiptImpl(...args);

export const updateWhere = (...args) => connection ? connection.run(() => updateWhereImpl(...args)) : updateWhereImpl(...args);

export const claimUnmappedSkuLink = (...args) => connection ? connection.run(() => claimUnmappedSkuLinkImpl(...args)) : claimUnmappedSkuLinkImpl(...args);

export const setCustomerGroupIfCurrent = (...args) => connection ? connection.run(() => setCustomerGroupIfCurrentImpl(...args)) : setCustomerGroupIfCurrentImpl(...args);

export const remove = (...args) => connection ? connection.run(() => removeImpl(...args)) : removeImpl(...args);

export async function removeAdminIfVersion(id, expectedVersion) {
  const operation = async () => {
    await ensureReady();
    if (mode === 'mongo') {
      const result = await (await getDb()).collection('admin_records').deleteOne({id,version:expectedVersion??null});
      return result.deletedCount===1;
    }
    const index=mem.admin_records.findIndex(row=>row.id===id&&(row.version??null)===(expectedVersion??null));
    if(index<0)return false;
    mem.admin_records.splice(index,1);
    return true;
  };
  return connection ? connection.run(operation) : operation();
}

export const removeIfPresent = (...args) => connection ? connection.run(() => removeIfPresentImpl(...args)) : removeIfPresentImpl(...args);

export const saveTaxGroup = (...args) => connection ? connection.run(() => saveTaxGroupImpl(...args)) : saveTaxGroupImpl(...args);

export const readTaxGroupSnapshot = (...args) => connection ? connection.run(() => readTaxGroupSnapshotImpl(...args)) : readTaxGroupSnapshotImpl(...args);

// All legacy handlers serialize dependency errors through this safe boundary.
export function sendDatabaseUnavailable(res, error) {
  if (error?.code === 'DATABASE_TIMEOUT') {
    res.status(504).json({ error: 'DATABASE_TIMEOUT', database: error.database || 'mongodb', message: 'The database operation timed out. Please try again.' });
    return true;
  }
  if (error?.code !== 'DATABASE_UNAVAILABLE') return false;
  res.status(503).json({ error: 'DATABASE_UNAVAILABLE', database: 'mongodb', message: databaseUnavailable().message });
  return true;
}

// Optimistic metadata edits preserve another request's complete update.
export async function updateIfRevision(collection, id, expectedRevision, fields) {
  const operation = async () => {
    await ensureReady();
    if (mode === 'mongo') {
      const query = expectedRevision === 0 ? { id, $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { id, revision: expectedRevision };
      const result = await (await getDb()).collection(collection).findOneAndUpdate(query, { $set: { ...fields, revision: expectedRevision + 1 } }, { returnDocument: 'after' });
      const doc = result?.value || result;
      return doc?.id == null ? null : stripId(doc);
    }
    const row = mem[collection].find(row => row.id === id && (row.revision || 0) === expectedRevision);
    if (!row) return null;
    Object.assign(row, fields, { revision: expectedRevision + 1 });
    return { ...row };
  };
  return connection ? connection.run(operation) : operation();
}
