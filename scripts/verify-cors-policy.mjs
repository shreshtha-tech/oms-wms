import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { allowedCorsOrigins, cors } from '../api/cors-policy.js';
import { cors as legacyCors } from '../api/mongo.js';
import { mutationOriginGuard } from '../reliability/http.js';

const previous = process.env.CORS_ORIGINS;
const app = express();
app.use('/api', (req, res, next) => { if (!cors(req, res)) next(); });
app.use('/api', mutationOriginGuard);
app.use('/api', (_req, _res, next) => next()); // Stands in for authentication after preflight.
app.all('/api/legacy', (req, res) => { if (!legacyCors(req, res)) res.json({ ok: true }); });
const server = app.listen(0, '127.0.0.1');
try {
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/legacy`;
  process.env.CORS_ORIGINS = 'https://app.example.test,http://localhost:5173';
  assert.deepEqual([...allowedCorsOrigins()].sort(), ['http://localhost:5173', 'https://app.example.test']);
  const allowed = await fetch(base, { headers: { Origin: 'https://app.example.test' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(allowed.headers.get('vary'), 'Origin');
  const denied = await fetch(base, { headers: { Origin: 'https://evil.example.test' } });
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(denied.headers.get('access-control-allow-credentials'), null);
  assert.equal((await fetch(base)).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(base, { method: 'POST', headers: { Origin: 'https://app.example.test' } })).status, 200);
  assert.equal((await fetch(base, { method: 'POST', headers: { Origin: 'https://evil.example.test' } })).status, 403);
  const preflight = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://app.example.test', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.test' } })).status, 403);
  assert.equal((await fetch(base, { method: 'OPTIONS' })).status, 204);
  for (const invalid of ['*', 'https://app.example.test/path', 'https://app.example.test, *', 'null']) {
    process.env.CORS_ORIGINS = invalid;
    assert.equal(allowedCorsOrigins().size, 0, `Invalid allowlist must fail closed: ${invalid}`);
    assert.equal((await fetch(base, { headers: { Origin: 'https://app.example.test' } })).headers.get('access-control-allow-origin'), null);
  }
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf("app.use('/api', (req, res, next) => { if (!cors(req, res)) next(); });") < source.indexOf("app.use('/api/inventory-sync',inventoryPublic)"));
  console.log('PASS CORS: exact origin allowlist, credentials only for allowed origins, preflight before auth, allowed/denied POST origin guard, missing/invalid/denied origins fail closed');
} finally {
  if (previous === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = previous;
  await new Promise(resolve => server.close(resolve));
}
