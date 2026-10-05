import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { publicReadiness, createDatasetHeaderObserver } from '../api/mongo-health.js';
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
assert.match(blueprint, /healthCheckPath: \/api\/health\/live/);
assert.match(blueprint, /key: TRUST_PROXY\s+value: "true"/);
const live = source.match(/app\.get\(\['\/health\/live'.*$/m)[0];
const readiness = source.slice(source.indexOf("app.get(['/health/ready'"), source.indexOf("app.use('/api', async"));
assert.ok(!/mongo|postgres|inventoryPool/i.test(live));
let registered, shuttingDown = false, mongo, probeSucceeded = true;
const app = { get: (_paths, handler) => { registered = handler; } };
const mount = new Function('app', 'shuttingDown', 'probeDataStore', 'inventoryPool', 'persistenceRequired', 'dataStoreDataset', 'inventoryDatabaseStatus', 'authConfigured', 'publicReadiness', readiness);
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
for (const state of ['UNREACHABLE', 'EMPTY_UNINITIALISED', 'AUTHENTICATION_FAILED', 'POPULATED']) {
  probeSucceeded = !['UNREACHABLE', 'AUTHENTICATION_FAILED'].includes(state);
  mongo = { state: probeSucceeded ? 'READY' : 'DEGRADED', datasetState: state, datasetEmpty: state === 'EMPTY_UNINITIALISED', selectedDatabase: 'private_fixture_database', maskedHost: 'private_fixture_host', presentCollections: 0 };
  new Function('app', 'shuttingDown', live)(app, shuttingDown);
  const livenessResponse = response(); registered({}, livenessResponse);
  assert.equal(livenessResponse.code, 200); assert.equal(livenessResponse.body.status, 'alive');
  mount(app, shuttingDown, async () => { if (!probeSucceeded) throw new Error('offline'); }, () => ({ query: async () => ({ rows: [{ schema_ready: true }] }) }), () => true, async () => mongo, () => ({ state: 'READY' }), () => true, publicReadiness);
  const readyResponse = response(); await registered({}, readyResponse);
  assert.equal(readyResponse.code, state === 'POPULATED' ? 200 : 503);
  assert.deepEqual(Object.keys(readyResponse.body).sort(), ['dependencies', 'ready', 'status']);
  assert.equal(readyResponse.body.dependencies.mongodb, ({ UNREACHABLE: 'UNREACHABLE', EMPTY_UNINITIALISED: 'EMPTY', AUTHENTICATION_FAILED: 'AUTH_FAILED', POPULATED: 'READY' })[state]);
  assert.ok(!/private_fixture|Collections|count|host|database/i.test(JSON.stringify(readyResponse.body).replace('mongodb', '').replace('postgres', '')));
}
const healthyInputs = { shuttingDown: false, schemaReady: true, postgresState: 'READY', mongoRequired: true, probeSucceeded: true, mongo: { state: 'READY', datasetState: 'POPULATED' }, authenticationRequired: true, authenticationConfigured: true };
for (const override of [{ shuttingDown: true }, { schemaReady: false }, { authenticationConfigured: false }]) assert.equal(publicReadiness({ ...healthyInputs, ...override }).ready, false);
new Function('app', 'shuttingDown', live)(app, true);
const stopping = response(); registered({}, stopping); assert.equal(stopping.body.status, 'stopping'); assert.equal(stopping.code, 200);
// Exercise the actual issueSession implementation with an injected offline pool.
const authSource = (await readFile(new URL('../api/auth-session.js', import.meta.url), 'utf8')).replace("import { inventoryPool } from '../inventory/db.js';", 'const inventoryPool = () => ({ query: async () => ({ rows: [] }) });');
const { issueSession } = await import(`data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`);
for (const trusted of [false, true]) {
  const proxyApp = express(); proxyApp.set('trust proxy', trusted ? 1 : false);
  const req = Object.create(proxyApp.request); req.app = proxyApp; req.connection = { remoteAddress: '127.0.0.1' }; req.headers = { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' };
  assert.equal(req.secure, trusted); assert.equal(req.ip, trusted ? '203.0.113.7' : '127.0.0.1');
  let cookie; await issueSession({ setHeader: (_name, value) => { cookie = value; } }, 'offline_fixture', req.secure);
  assert.equal(/; Secure/.test(cookie), trusted);
}
assert.match(source, /issueSession\(res, username, req.secure\)/);
assert.match(await readFile(new URL('../reliability/login-limiter.js', import.meta.url), 'utf8'), /\[req.ip, `\$\{req.ip\}:\$\{username\}`\]/);
// Extract the actual mapped-route wrapper and run it with a hung inspection.
const wrapper = source.slice(source.indexOf('for (const [route, handler]'), source.indexOf("app.use('/api', (_req"));
let inspections = 0;
const observeDatasetHeader = createDatasetHeaderObserver(() => { inspections++; return new Promise(() => {}); });
let mapped;
new Function('app', 'routes', 'mongoRoutes', 'observeDatasetHeader', wrapper)({ all: (_route, handler) => { mapped = handler; } }, { '/api/skus': async (_req, res) => res.status(503).json({ error: 'DATABASE_UNAVAILABLE' }) }, new Set(['/api/skus']), observeDatasetHeader);
const started = performance.now();
for (let i = 0; i < 20; i++) { const res = response(); res.set = () => {}; await mapped({}, res, error => { throw error; }); assert.equal(res.code, 503); }
assert.ok(performance.now() - started < 1000); assert.equal(inspections, 1);
await new Promise(resolve => setTimeout(resolve, 800));
await mapped({}, Object.assign(response(), { set() {} }), error => { throw error; });
assert.equal(inspections, 1, 'Timeout must retain the refresh cooldown');
const headers = {};
const emptyObserver = createDatasetHeaderObserver(async () => ({ datasetEmpty: true }));
const headerResponse = { set: (key, value) => { headers[key] = value; } };
emptyObserver(headerResponse); await new Promise(resolve => setImmediate(resolve)); emptyObserver(headerResponse);
assert.equal(headers['X-Mongo-Dataset-Empty'], 'true');
assert.ok(source.indexOf("app.use('/api/inventory-sync',inventoryPublic)") < source.indexOf('app.use(express.json'));
assert.ok(source.indexOf("app.use('/api', async") < source.indexOf("app.get('/api/health/databases'"));
assert.match(await readFile(new URL('../src/components/MongoStatusBanner.tsx', import.meta.url), 'utf8'), /fetch\('\/api\/health\/databases'/);
console.log('PASS offline Render health: actual live/ready/mapped handlers, minimal payload, proxy cookie/IP, hung inspection, empty header and route ordering; no database connections');
