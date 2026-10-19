import assert from 'node:assert/strict';
import { resolveMongoConfiguration } from '../api/mongo-config.js';
import { createMongoConnection } from '../api/mongo-connection.js';
import { inspectMongoDataset } from '../api/mongo-dataset.js';
import { mongoReadinessSatisfied, mongoHealthPayload, applyMongoDatasetHeader } from '../api/mongo-health.js';
import { argumentsOf, requireSelectedDatabase, requireRestoreTarget, externalOutputFolder, inventoryMongo } from './mongo-tooling.mjs';
const uri = 'mongodb+srv://fixture_user:fixture_password@fixture.cluster.mongodb.net/uri_database';
const env = { MONGODB_URI: uri, MONGODB_DB: 'fixture_database' };
const config = resolveMongoConfiguration(env);
assert.deepEqual(config.warnings, ['MONGODB_URI_DATABASE_OVERRIDDEN']);
assert.equal(resolveMongoConfiguration({}).selectedDatabase, 'd_mills_global');
assert.equal(resolveMongoConfiguration({ NODE_ENV: 'production' }).selectedDatabase, 'd_mills_global');
assert.equal(resolveMongoConfiguration({ DMILLS_REQUIRE_PERSISTENCE: 'true', MONGODB_DB: ' ' }).selectedDatabase, 'd_mills_global');
assert.throws(() => resolveMongoConfiguration({ ...env, MONGODB_URI: uri + '?tlsInsecure=true' }), /verification/);
assert.throws(() => requireSelectedDatabase({ '--db': 'fixture_database' }, env, true), /--yes/);
assert.throws(() => requireSelectedDatabase({ '--db': 'different', '--yes': true }, env, true), /exact selected/);
assert.equal(requireSelectedDatabase({ '--db': 'fixture_database', '--yes': true }, env, true).selectedDatabase, 'fixture_database');
assert.throws(() => requireRestoreTarget({}), /explicit/);
assert.throws(() => requireRestoreTarget({ '--target': 'business' }), /_test/);
assert.equal(requireRestoreTarget({ '--target': 'business_test' }), 'business_test');
assert.equal(requireRestoreTarget({ '--target': 'business', '--i-understand-production': true }), 'business');
assert.throws(() => argumentsOf(['--yes', '--yes']), /duplicate/);
await assert.rejects(externalOutputFolder('forbidden-backup'), /outside/);
const fakeDb = (names, counts = {}) => ({ listCollections: () => ({ toArray: async () => names.map(name => ({ name })) }), collection: name => ({ estimatedDocumentCount: async () => counts[name] || 0 }) });
const empty = await inspectMongoDataset(fakeDb(['_counters'], { _counters: 64 }), ['skus', 'sale_orders']);
assert.equal(empty.datasetEmpty, true); assert.equal(empty.presentCollections, 0);
const structure = await inspectMongoDataset(fakeDb(['skus']), ['skus']);
assert.equal(structure.datasetEmpty, true); assert.equal(structure.presentCollections, 1);
const populated = await inspectMongoDataset(fakeDb(['skus'], { skus: 2 }), ['skus', 'sale_orders']);
assert.equal(populated.datasetState, 'POPULATED'); assert.equal(populated.populatedCollections, 1);
assert.equal(mongoReadinessSatisfied(true, true, { state: 'READY', ...empty }), false);
assert.equal(mongoReadinessSatisfied(true, true, { state: 'READY', ...populated }), true);
const headers = {}; applyMongoDatasetHeader({ set: (key, value) => { headers[key] = value; } }, empty);
assert.equal(headers['X-Mongo-Dataset-Empty'], 'true');
let available = false, auth = false, writes = 0;
class Client {
  async connect() { if (!available) throw Object.assign(new Error('fixture password hidden'), { name: 'MongoNetworkError' }); if (auth) throw Object.assign(new Error('fixture password hidden'), { code: 18 }); }
  db() { return { ...fakeDb(['skus'], { skus: 1 }), command: async () => ({ ok: 1 }), insertOne: () => { writes++; } }; }
  async close() {}
}
const logs = [];
let constructorAttempts = 0;
class InitiallyBrokenClient extends Client {
  constructor() { super(); if (++constructorAttempts === 1) throw new Error('private driver construction failure'); }
}
available = true;
const constructorRecovery = createMongoConnection({ uri, database: 'fixture_database', Client: InitiallyBrokenClient, retryMs: 0, log: (...args) => logs.push(args) });
await assert.rejects(constructorRecovery.connect(), error => error.code === 'DATABASE_UNAVAILABLE');
await constructorRecovery.connect();
assert.equal(constructorAttempts, 2);
assert.equal(constructorRecovery.status().state, 'READY');
await constructorRecovery.close();
available = false;
const connection = createMongoConnection({ uri, database: 'fixture_database', Client, retryMs: 0, log: (...args) => logs.push(args) });
await assert.rejects(connection.connect(), error => error.code === 'DATABASE_UNAVAILABLE' && error.status === 503);
assert.equal((await connection.datasetStatus()).datasetState, 'UNREACHABLE');
available = true;
await connection.connect(); assert.equal(connection.status().state, 'READY');
assert.equal((await connection.datasetStatus()).datasetState, 'POPULATED');
await assert.rejects(connection.run(() => { throw Object.assign(new Error('secret'), { code: 18 }); }), error => error.code === 'DATABASE_UNAVAILABLE');
auth = true;
assert.equal((await connection.datasetStatus()).datasetState, 'AUTHENTICATION_FAILED');
auth = false; await connection.connect();
assert.equal((await connection.datasetStatus()).datasetState, 'POPULATED');
const payload = mongoHealthPayload(config, connection.status(), populated);
for (const secret of ['fixture_user', 'fixture_password', 'fixture.cluster', uri]) assert.ok(!JSON.stringify({ payload, logs }).includes(secret));
assert.equal(writes, 0); await connection.close();
const restricted = { db: name => name === 'admin' ? { admin: () => ({ listDatabases: async () => { throw Object.assign(new Error('secret'), { code: 13 }); } }) } : fakeDb(['skus'], { skus: 2 }) };
const inventory = await inventoryMongo(restricted, 'fixture_database', ['skus', 'sale_orders']);
assert.match(inventory.visibility, /Other databases are unknown/);
assert.deepEqual(inventory.databases[0].expectedPresent, ['skus']);
console.log('PASS offline Mongo safety: configuration, auth/outage/recovery, empty/populated, readiness/header, redaction, restricted inventory and tool guards; zero database writes or live connections');
// File-format integration uses an injected driver only, never MongoDB.
const { main: backup } = await import('./mongo-backup.mjs');
const { main: restore } = await import('./mongo-restore.mjs');
const { mkdtemp, rm, readFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const path = await import('node:path');
const { BSON } = await import('mongodb');
const folder = await mkdtemp(path.join(tmpdir(), 'mongo-safety-fixture-'));
let clientCreations = 0;
const fixtureDocument = { _id: new BSON.ObjectId(), quantity: BSON.Long.fromString('9007199254740993'), at: new Date('2026-01-01T00:00:00Z') };
class ExportClient {
  constructor() { clientCreations++; }
  async connect() {}
  db() { return { listCollections: () => ({ toArray: async () => [{ name: 'skus', type: 'collection', options: {} }] }), collection: () => ({ find: async function* () { yield fixtureDocument; }, listIndexes: () => ({ toArray: async () => [{ name: '_id_', key: { _id: 1 } }] }) }) }; }
  async close() {}
}
const quiet = [];
try {
  await assert.rejects(backup(['--db', 'fixture_database', '--out', path.join(folder, 'backup')], { env, Client: ExportClient }), /--yes/);
  await assert.rejects(backup(['--db', 'wrong', '--yes', '--out', path.join(folder, 'backup')], { env, Client: ExportClient }), /exact selected/);
  assert.equal(clientCreations, 0);
  await backup(['--db', 'fixture_database', '--yes', '--out', path.join(folder, 'backup')], { env, Client: ExportClient, output: value => quiet.push(value) });
  const exported = BSON.EJSON.parse((await readFile(path.join(folder, 'backup', '0.ndjson'), 'utf8')).trim(), { relaxed: false });
  assert.equal(exported.quantity.toString(), fixtureDocument.quantity.toString());
  assert.equal(exported._id.toHexString(), fixtureDocument._id.toHexString());
  assert.equal(exported.at.toISOString(), fixtureDocument.at.toISOString());
  const before = clientCreations;
  await restore(['--target', 'fixture_test', '--from', path.join(folder, 'backup')], { env, Client: ExportClient, output: value => quiet.push(value) });
  assert.equal(clientCreations, before, 'Restore default dry-run must not instantiate a database client');
  await assert.rejects(restore(['--target', 'business', '--from', path.join(folder, 'backup')], { env, Client: ExportClient }), /_test/);
  await assert.rejects(restore(['--target', 'fixture_test', '--from', path.join(folder, 'backup'), '--yes'], { env, Client: ExportClient }), /new database/);
  for (const secret of ['fixture_user', 'fixture_password', fixtureDocument._id.toHexString()]) assert.ok(!JSON.stringify(quiet).includes(secret));
  console.log('PASS offline export/restore integration: canonical BSON types, outside-repo files, integrity manifest, dry-run zero connections, non-test/nonempty target refusal');
} finally { await rm(folder, { recursive: true, force: true }); }

// Deployment health contracts use only injected offline dependencies.
await import('./verify-render-health-offline.mjs');
