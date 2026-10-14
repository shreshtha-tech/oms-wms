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
import { readMongoRows, readMongoOne, checkMongoReadBudget, mongoDocumentBytes, mongoResultLimit } from './mongo-read.js';
import { withMongoSession } from './mongo-session.js';
import { validateMongoUpdate, updateMongoDocuments, updateMongoQuery, mongoMutationBudget } from './mongo-mutation.js';

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
  return connection.run(() => withMongoSession(mongoClient, session => operation(db, session)));
}
export async function updateWmsZonePickers(id, pickers, action, modifiedBy = 'unknown') {
  if (!Number.isSafeInteger(id) || id <= 0 || !Array.isArray(pickers) || pickers.length < 1 || pickers.length > 200 ||
      pickers.some(picker => typeof picker !== 'string' || !picker.trim() || picker.length > 100) ||
      !['link-pickers', 'unlink-pickers'].includes(action)) {
    throw Object.assign(new Error('Invalid zone-picker mutation.'), { code: 'DATABASE_MUTATION_INVALID', status: 400, statusCode: 400 });
  }
  await ensureReady();
  const unique = [...new Set(pickers.map(picker => picker.trim()))];
  const audit = { modified_by: String(modifiedBy).slice(0, 100), modified_date: new Date().toISOString() };
  if (mode === 'memory') {
    const row = mem.generic_records.find(record => record.id === id && record.module === 'wms-zone');
    if (!row) return null;
    if (row.linked_pickers != null && !Array.isArray(row.linked_pickers)) throw Object.assign(new Error('Legacy zone picker data requires migration.'), { code: 'WMS_ZONE_PICKERS_LEGACY', status: 409, statusCode: 409 });
    const current = row.linked_pickers || [];
    const next = action === 'link-pickers' ? [...current, ...unique.filter(picker => !current.includes(picker))] : current.filter(picker => !unique.includes(picker));
    if (action === 'link-pickers' && next.length > 1000) throw Object.assign(new Error('Zone picker link limit exceeded.'), { code: 'WMS_ZONE_PICKERS_LIMIT', status: 413, statusCode: 413 });
    row.linked_pickers = next;
    Object.assign(row, audit);
    return { ...row, linked_pickers: [...row.linked_pickers] };
  }
  const collection = (await getDb()).collection('generic_records');
  const operation = action === 'link-pickers'
    ? { $addToSet: { linked_pickers: { $each: unique } }, $set: audit }
    : { $pull: { linked_pickers: { $in: unique } }, $set: audit };
  const currentArray = { $cond: [{ $isArray: '$linked_pickers' }, '$linked_pickers', []] };
  const capacityFilter = action === 'link-pickers' ? { $expr: { $lte: [
    { $add: [{ $size: currentArray }, { $size: { $setDifference: [{ $literal: unique }, currentArray] } }] },
    1000,
  ] } } : {};
  return connection.run(() => collection.findOneAndUpdate(
    { id, module: 'wms-zone', $or: [{ linked_pickers: { $exists: false } }, { linked_pickers: { $type: 'array' } }], ...capacityFilter }, operation,
    { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 },
  ));
}
export async function bulkLinkWmsZonePickers(links, modifiedBy = 'unknown') {
  const invalid = (message, code = 'WMS_ZONE_BULK_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, status: statusCode, statusCode });
  if (!Array.isArray(links) || links.length < 1 || links.length > 200) throw invalid('Invalid zone-picker batch.');
  const grouped = new Map();
  const seen = new Set();
  for (const link of links) {
    if (!link || !Number.isSafeInteger(link.id) || link.id <= 0 || typeof link.zone !== 'string' || !link.zone.trim() || link.zone.length > 100 ||
        typeof link.picker !== 'string' || !link.picker.trim() || link.picker.length > 100) throw invalid('Invalid zone-picker batch.');
    const zone = link.zone.trim(), picker = link.picker.trim();
    const key = JSON.stringify([link.id, picker]);
    if (seen.has(key)) throw invalid('Duplicate zone-picker link.');
    seen.add(key);
    const group = grouped.get(link.id) || { id: link.id, zone, pickers: [] };
    if (group.zone !== zone) throw invalid('Conflicting zone identity.');
    group.pickers.push(picker);
    grouped.set(link.id, group);
  }
  const groups = [...grouped.values()];
  const audit = { modified_by: String(modifiedBy).slice(0, 100), modified_date: new Date().toISOString() };
  await ensureReady();
  const check = (records) => {
    const byId = new Map(records.map(record => [record.id, record]));
    if (records.length !== groups.length || byId.size !== groups.length) throw invalid('Zone was not found or is ambiguous.', 'WMS_ZONE_BULK_CONFLICT', 409);
    for (const group of groups) {
      const row = byId.get(group.id);
      if (!row || row.module !== 'wms-zone' || String(row.zone_code || row.code || '') !== group.zone) throw invalid('Zone identity changed.', 'WMS_ZONE_BULK_CONFLICT', 409);
      if (Object.hasOwn(row, 'linked_pickers') && !Array.isArray(row.linked_pickers)) throw invalid('Legacy zone picker data requires migration.', 'WMS_ZONE_PICKERS_LEGACY', 409);
      const current = row.linked_pickers || [];
      if (current.length + group.pickers.filter(picker => !current.includes(picker)).length > 1000) throw invalid('Zone picker link limit exceeded.', 'WMS_ZONE_PICKERS_LIMIT', 413);
    }
    return byId;
  };
  if (mode === 'memory') {
    const byId = check(mem.generic_records.filter(record => grouped.has(record.id) && record.module === 'wms-zone'));
    for (const group of groups) {
      const row = byId.get(group.id);
      const current = row.linked_pickers || [];
      row.linked_pickers = [...current, ...group.pickers.filter(picker => !current.includes(picker))];
      Object.assign(row, audit);
    }
    return { zones: groups.length, links: links.length };
  }
  return mongoDomainTransaction(async (db, session) => {
    const collection = db.collection('generic_records');
    check(await readMongoRows(collection, { id: { $in: groups.map(group => group.id) }, module: 'wms-zone' }, { session }));
    for (const group of groups) {
      const result = await collection.updateOne({ id: group.id, module: 'wms-zone' },
        { $addToSet: { linked_pickers: { $each: group.pickers } }, $set: audit }, { session });
      if (result.matchedCount !== 1) throw invalid('Zone identity changed.', 'WMS_ZONE_BULK_CONFLICT', 409);
    }
    return { zones: groups.length, links: links.length };
  });
}
export async function findWmsPickerCandidates(codes) {
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 200 || codes.some(code => typeof code !== 'string' || !code.trim() || code.length > 100)) {
    throw Object.assign(new Error('Invalid picker lookup.'), { code: 'WMS_ZONE_BULK_INVALID', status: 400, statusCode: 400 });
  }
  const wanted = [...new Set(codes.map(code => code.trim()))];
  await ensureReady();
  if (mode === 'memory') {
    const rows = mem.generic_records.filter(row => row.module === 'user-enquiry' && wanted.includes(row.code));
    if (rows.length > 1000) throw mongoResultLimit();
    let bytes = 0;
    for (const row of rows) { bytes += mongoDocumentBytes(row); checkMongoReadBudget(0, bytes); }
    return rows.map(row => ({ ...row }));
  }
  return connection.run(async () => {
    const rows = await readMongoRows((await getDb()).collection('generic_records'), { module: 'user-enquiry', code: { $in: wanted } }, { limit: 1001 });
    if (rows.length > 1000) throw mongoResultLimit();
    return rows;
  });
}
export async function mongoIndexSpecifications(collection) {
  const db = await getDb();
  return connection.run(() => db.collection(collection).listIndexes({ maxTimeMS: 15000, timeoutMS: 15000 }).toArray());
}
async function ensureReady() {
  if (connection) { await getDb(); return; }
  if (persistenceRequired()) throw Object.assign(databaseUnavailable(), { message: 'MONGODB_URI is required when persistent storage is enforced.' });
  initMemory();
}

async function nextId(db, c) {
  const top = await db.collection(c).findOne({}, { projection: { id: 1 }, sort: { id: -1 }, timeoutMS: 15000, maxTimeMS: 15000 });
  await db.collection('_counters').updateOne({ _id: c }, { $max: { seq: Number(top?.id) || 0 } }, { upsert: true, timeoutMS: 15000, maxTimeMS: 15000 });
  const r = await db.collection('_counters').findOneAndUpdate(
    { _id: c }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 }
  );
  const doc = r; // Explicit document result for the installed Mongo driver.
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
    const docs = await readMongoRows(db.collection(collection), query, { sort, projection });
    return docs.map(stripId);
  }
  let rows = mem[collection].filter((r) => matches(r, query));
  if (sort) {
    const [field, dir] = Object.entries(sort)[0];
    rows = [...rows].sort((a, b) => (a[field] > b[field] ? 1 : -1) * dir);
  }
  checkMongoReadBudget(rows.length, 0);
  let bytes = 0;
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
    bytes += mongoDocumentBytes(doc);
    checkMongoReadBudget(0, bytes);
    return doc;
  });
}

async function findOneImpl(collection, query = {}) {
  if (collection === 'products') collection = 'skus';
  await ensureReady();
  if (mode === 'mongo') return stripId(await readMongoOne((await getDb()).collection(collection), query));
  const row = mem[collection].find(row => matches(row, query));
  if (!row) return null;
  checkMongoReadBudget(1, mongoDocumentBytes(row));
  return { ...row };
}

async function ensureIndexImpl(collection, keys, options) {
  await ensureReady();
  if (mode !== 'mongo') return null;
  return (await getDb()).collection(collection).createIndex(keys, options);
}

async function insertImpl(collection, doc) {
  if (doc?.id != null) throw Object.assign(new Error('New record identity is allocated by the data store.'), { code: 'DATABASE_MUTATION_INVALID', status: 400, statusCode: 400 });
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
    const full = { ...doc, id };
    await db.collection(collection).insertOne(full);
    return stripId(full);
  }
  if (collection === 'skus' && mem[collection].some(row => String(row.sku_code).toLowerCase() === String(doc.sku_code).toLowerCase())) throw Object.assign(new Error('SKU Code already exists'), { code: 11000 });
  const id = ++memSeq[collection];
  const full = { ...doc, id };
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
      { $set: changes, $push: { audit: auditEntry } }, { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 },
    );
    const row = result;
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
  const list = validateMongoUpdate(ids, fields);
  if (!list.length) return [];
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    const docs = await updateMongoDocuments(db.collection(collection), list, fields, mongoClient);
    return docs.map(stripId);
  }
  const selected = new Set(list);
  const updated = mem[collection].filter(row => selected.has(row.id)).map(row => ({ ...row, ...fields }));
  if (list.length > 1) checkMongoReadBudget(updated.length, updated.reduce((bytes, row) => bytes + mongoDocumentBytes(row), 0));
  mem[collection] = mem[collection].map((r) => {
    if (selected.has(r.id)) return { ...r, ...fields };
    return r;
  });
  return updated.map((r) => ({ ...r }));
}

// Atomically move a GRN between receipt states. A stale handler must not
// replace a newer staged/committed request after a cross-database boundary.
async function transitionGrnReceiptImpl(id, expected, fields) {
  validateMongoUpdate(id, fields);
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
      { $set: fields }, { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 },
    );
    const doc = result;
    return doc?.id == null ? null : stripId(doc);
  }
  const row = mem.grn.find(matchesExpected);
  if (!row) return null;
  Object.assign(row, fields);
  return { ...row };
}

// Update rows matching an arbitrary query (used e.g. by GRN -> PO close).
async function updateWhereImpl(collection, query, fields) {
  validateMongoUpdate([], fields);
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    await updateMongoQuery(db.collection(collection), query, fields, mongoClient);
    return;
  }
  const count = mem[collection].filter(row => matches(row, query)).length;
  if (count > mongoMutationBudget.ids) throw Object.assign(new Error('Query update exceeds the supported batch size.'), { code: 'DATABASE_MUTATION_LIMIT', status: 413, statusCode: 413 });
  mem[collection] = mem[collection].map((r) => (matches(r, query) ? { ...r, ...fields } : r));
}

// Atomically attach an SKU only while a seller listing is still unmapped.
// Missing and empty values are both treated as unmapped for legacy rows.
async function claimUnmappedSkuLinkImpl(id, fields) {
  validateMongoUpdate(id, fields);
  await ensureReady();
  if (mode === 'mongo') {
    const db = await getDb();
    const result = await db.collection('sku_channel_links').findOneAndUpdate(
      { id, eretail_sku: { $in: [null, ''] }, sku_code: { $in: [null, ''] } },
      { $set: fields },
      { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 },
    );
    const doc = result;
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
    const hello = await db.admin().command({ hello: 1 }, { timeoutMS: 15000 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw Object.assign(new Error('Tax Group changes require transactional MongoDB storage.'), { statusCode: 503 });
      return await withMongoSession(mongoClient, async session => {
        // Shared transaction-owned write serializes uniqueness and replacements
        // across processes; driver retries re-read all authoritative state.
        await db.collection('_counters').updateOne({ _id: 'tax_group_save_revision' }, { $inc: { seq: 1 } }, { upsert: true, session });
        const groups = await readMongoRows(db.collection('generic_records'), { module: 'tax-group' }, { session });
        const current = groups.find(row => row.id === id);
        const mappings = id == null ? [] : await readMongoRows(db.collection('tax_group_codes'), { group_id: id }, { session });
        const codes = await readMongoRows(db.collection('tax_codes'), {}, { session });
        validate(groups, current, mappings, codes);
        const allocate = async collection => {
          const result = await db.collection('_counters').findOneAndUpdate({ _id: collection }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false, session });
          return result.seq;
        };
        const groupId = id ?? await allocate('generic_records');
        if (id == null) await db.collection('generic_records').insertOne({ ...fields, id: groupId }, { session });
        else await db.collection('generic_records').updateOne({ id, module: 'tax-group' }, { $set: fields }, { session });
        await db.collection('tax_group_codes').deleteMany({ group_id: groupId }, { session });
        for (const [index, component] of components.entries()) await db.collection('tax_group_codes').insertOne({ ...component, id: await allocate('tax_group_codes'), group_id: groupId, sequence: index + 1 }, { session });
        return groupId;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
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
    const hello = await db.admin().command({ hello: 1 }, { timeoutMS: 15000 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw Object.assign(new Error('Tax Group reads require snapshot-capable MongoDB storage.'), { statusCode: 503 });
      return await withMongoSession(mongoClient, async session => {
        const groups = await readMongoRows(db.collection('generic_records'), { module: 'tax-group' }, { session, sort: { id: -1 } });
        const mappings = await readMongoRows(db.collection('tax_group_codes'), {}, { session });
        const codes = await readMongoRows(db.collection('tax_codes'), {}, { session });
        return [groups.map(stripId), mappings.map(stripId), codes.map(stripId)];
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
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

// The owner predicate must be part of the write, not a handler precheck.
export async function updateOwnedDownload(id, owner, fields) {
  validateMongoUpdate(id, fields);
  const operation = async () => {
    await ensureReady();
    if (mode === 'mongo') {
      const doc = await (await getDb()).collection('downloads').findOneAndUpdate(
        { id, exported_by: owner }, { $set: fields },
        { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 },
      );
      return doc ? stripId(doc) : null;
    }
    const row = mem.downloads.find(item => item.id === id && item.exported_by === owner);
    if (!row) return null;
    Object.assign(row, fields);
    return { ...row };
  };
  return connection ? connection.run(operation) : operation();
}

// Compare the observed admin version in the write itself; a separate handler
// precheck cannot prevent concurrent credential or permission replacements.
export async function updateAdminIfVersion(id, expectedVersion, fields) {
  validateMongoUpdate(id, fields);
  const operation = async () => {
    await ensureReady();
    const version = (expectedVersion ?? 0) + 1;
    if (mode === 'mongo') {
      const result = await (await getDb()).collection('admin_records').findOneAndUpdate(
        {id, version:expectedVersion ?? null},
        {$set:{...fields,version}}, {returnDocument:'after',includeResultMetadata:false,timeoutMS:15000,maxTimeMS:15000},
      );
      const doc = result;
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
  if (['DATABASE_MUTATION_LIMIT', 'DATABASE_MUTATION_INVALID'].includes(error?.code)) {
    res.status(error.code === 'DATABASE_MUTATION_LIMIT' ? 413 : 400).json({ error: error.code, database: 'mongodb', message: error.code === 'DATABASE_MUTATION_LIMIT' ? 'The update exceeds the supported batch size. Reduce the number of records or update fields.' : 'The update requires valid record IDs and immutable record identity.' });
    return true;
  }
  if (error?.code === 'DATABASE_COMMIT_UNCERTAIN') {
    res.status(503).json({ error: 'DATABASE_COMMIT_UNCERTAIN', database: error.database === 'postgresql' ? 'postgresql' : 'mongodb', message: 'The transaction commit outcome is unknown. Preserve the request identity and reconcile its result before retrying.' });
    return true;
  }
  if (error?.code === 'DATABASE_RESULT_LIMIT') {
    res.status(413).json({ error: 'DATABASE_RESULT_LIMIT', database: 'mongodb', message: 'The result exceeds the supported read size. Narrow the search or use a paginated workflow.' });
    return true;
  }
  if (error?.code === 'DATABASE_TIMEOUT') {
    res.status(504).json({ error: 'DATABASE_TIMEOUT', database: error.database || 'mongodb', message: 'The database operation timed out. Please try again.' });
    return true;
  }
  if (error?.code !== 'DATABASE_UNAVAILABLE') return false;
  res.status(503).json({ error: 'DATABASE_UNAVAILABLE', database: 'mongodb', message: databaseUnavailable().message });
  return true;
}

// Optimistic metadata edits preserve another request's complete update.
// Serialize validation-master uniqueness and default replacement as one save.
export async function saveValidationMaster(id, fields) {
  const definitions = { 'receipt-validation': ['receiving_validation_code', 'isDefault'], 'lottable-validation': ['lot_val_code', 'is_default'] };
  const definition = definitions[fields?.module];
  if (!definition) throw Object.assign(new Error('Unsupported validation master.'), { statusCode: 400 });
  validateMongoUpdate(id == null ? [] : id, fields);
  const [codeField, defaultField] = definition;
  const check = rows => {
    if (id != null && !rows.some(row => row.id === id)) throw Object.assign(new Error('Validation was not found.'), { statusCode: 404 });
    if (rows.some(row => row.id !== id && String(row[codeField] || row.code || '').trim().toUpperCase() === fields.code)) throw Object.assign(new Error('Validation Code already exists.'), { statusCode: 409 });
  };
  const operation = async () => {
    await ensureReady();
    if (mode === 'mongo') {
      const db = await getDb();
      return withMongoSession(mongoClient, async session => {
        await db.collection('_counters').updateOne({ _id: `validation_save:${fields.module}` }, { $inc: { seq: 1 } }, { upsert: true, session });
        const collection = db.collection('generic_records');
        const rows = await readMongoRows(collection, { module: fields.module }, { session });
        check(rows);
        if (fields[defaultField]) await collection.updateMany({ module: fields.module }, { $set: { [defaultField]: false } }, { session });
        let recordId = id;
        if (recordId == null) {
          const top = await collection.findOne({}, { sort: { id: -1 }, projection: { id: 1 }, session });
          await db.collection('_counters').updateOne({ _id: 'generic_records' }, { $max: { seq: Number(top?.id) || 0 } }, { upsert: true, session });
          recordId = (await db.collection('_counters').findOneAndUpdate({ _id: 'generic_records' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false, session })).seq;
          await collection.insertOne({ ...fields, id: recordId }, { session });
        } else await collection.updateOne({ id, module: fields.module }, { $set: fields }, { session });
        return stripId(await collection.findOne({ id: recordId }, { session }));
      });
    }
    const rows = mem.generic_records.filter(row => row.module === fields.module);
    check(rows);
    const recordId = id ?? ++memSeq.generic_records;
    if (fields[defaultField]) for (const row of rows) row[defaultField] = false;
    if (id == null) mem.generic_records.push({ ...fields, id: recordId });
    else Object.assign(mem.generic_records.find(row => row.id === id), fields);
    return { ...mem.generic_records.find(row => row.id === recordId) };
  };
  return connection ? connection.run(operation) : operation();
}

export async function updateIfRevision(collection, id, expectedRevision, fields) {
  validateMongoUpdate(id, fields);
  const operation = async () => {
    await ensureReady();
    if (mode === 'mongo') {
      const query = expectedRevision === 0 ? { id, $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { id, revision: expectedRevision };
      const result = await (await getDb()).collection(collection).findOneAndUpdate(query, { $set: { ...fields, revision: expectedRevision + 1 } }, { returnDocument: 'after', includeResultMetadata: false, timeoutMS: 15000, maxTimeMS: 15000 });
      const doc = result;
      return doc?.id == null ? null : stripId(doc);
    }
    const row = mem[collection].find(row => row.id === id && (row.revision || 0) === expectedRevision);
    if (!row) return null;
    Object.assign(row, fields, { revision: expectedRevision + 1 });
    return { ...row };
  };
  return connection ? connection.run(operation) : operation();
}
