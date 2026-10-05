import { chromium } from 'playwright';
import { homedir } from 'node:os';
import { join } from 'node:path';
import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import pg from 'pg';
const mongoUri = new URL(process.env.MONGODB_URI || '');
assert.equal(mongoUri.hostname, '127.0.0.1');
assert.ok(process.env.MONGO_TEST_PROCESS_PID, 'A disposable MongoDB process is required');
const configured = new URL(process.env.INVENTORY_DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1','::1'].includes(configured.hostname));
const name = `codexqa_reliability_${randomUUID().replaceAll('-','').slice(0,12)}`;
const admin = new pg.Client({ connectionString: configured.toString(), connectionTimeoutMillis: 8000 });
const password = randomBytes(24).toString('hex'), salt = randomBytes(16).toString('hex');
const user = `qa_${name}`;
const hash = `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const url = new URL(configured); url.pathname = `/${name}`;
const port = 3149, base = `http://127.0.0.1:${port}`;
let server, browser, created = false, paused = false;
const counts = {}, outcomes = [];
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(35000) });
  counts[response.status] = (counts[response.status] || 0) + 1;
  const body = await response.json().catch(() => null);
  return { status: response.status, body, response };
};
try {
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created = true;
  process.env.INVENTORY_DATABASE_URL = url.toString();
  const { migrateInventory, inventoryPool } = await import('../inventory/db.js');
  await migrateInventory(); await inventoryPool().end();
  server = spawn(process.execPath,['server.js'], { env: { ...process.env, PORT: String(port), DMILLS_ADMIN_USER: user, DMILLS_ADMIN_PASSWORD_HASH: hash, INVENTORY_ALLOWED_TENANT_ID: name, INVENTORY_CREDENTIAL_KEY: randomBytes(32).toString('hex'), DMILLS_REQUIRE_PERSISTENCE: 'true' }, stdio: ['ignore','ignore','pipe'] });
  let diagnostic = '';
  server.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-10000); });
  for (let i=0;i<100;i++) { try { if((await request('/health/ready')).status===200)break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.equal((await request('/health/live')).status,200);
  assert.equal((await request('/api/sku-groups')).status,401);
  const login = await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password})}); assert.equal(login.status,200);
  const cookie = login.response.headers.get('set-cookie').split(';',1)[0];
  const headers = { cookie, 'content-type':'application/json' };
  assert.equal((await request('/api/missing-reliability-route',{headers})).status,404);
  assert.equal((await request('/api/sku-groups',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await request('/api/inventory-sync/central/summary?tenantId=foreign',{headers})).status,403);
  const source = await readFile('server.js','utf8');
  const block = source.slice(source.indexOf('const routes = {'),source.indexOf('for (const [route, handler]'));
  const routes = [...new Set([...block.matchAll(/"(\/api\/[^" ]+)"\s*:/g)].map(match=>match[1]))];
  for (const route of routes) {
    const result = await request(route,{headers});
    outcomes.push({route,status:result.status,error:result.body?.error});
    assert.notEqual(result.body?.error,'ROUTE_NOT_FOUND',`Mounted route missing: ${route}`);
    assert.notEqual(result.status,500,`Unhandled GET: ${route}`);
  }
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  let executablePath;
  for (const folder of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    const candidate = join(cache, folder, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  assert.ok(executablePath, 'Installed test browser required');
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);
  await page.getByLabel('Login Id').fill(user); await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click(); await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/m/sku-group`);
  await page.getByRole('button', { name: 'Add New', exact: true }).waitFor();
  assert.ok(await page.getByText('No records to view', { exact: true }).count());
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  await page.getByLabel('SKU Group Code *', { exact: true }).fill('UNSAVED-DRAFT');
  await page.getByLabel('SKU Group Name *', { exact: true }).fill('Draft retained during outage');
  process.kill(Number(process.env.MONGO_TEST_PROCESS_PID),'SIGSTOP'); paused = true;
  await page.evaluate(() => window.dispatchEvent(new Event('api-recovered')));
  await page.locator('[role=alert]:visible').getByText(/Data temporarily unavailable|Request timed out/).first().waitFor({ timeout: 35000 });
  for(const empty of await page.getByText('No records to view', { exact: true }).all())assert.equal(await empty.isVisible(), false);
  await page.screenshot({ path: 'tmp/mongo-reliability/sku-group-outage.png' });
  const outage = await request('/api/sku-groups',{headers});
  if(outage.status!==503)console.log(JSON.stringify({outage,diagnostic},null,2));
  assert.equal(outage.status,503); assert.equal(outage.body.error,'DATABASE_UNAVAILABLE'); assert.ok(!('rows' in outage.body));
  assert.equal((await request('/health/live')).status,200);
  assert.equal((await request('/health/ready')).status,503);
  assert.equal((await request('/api/inventory-sync/central/summary',{headers})).status,200,'PostgreSQL-only data remains accessible during Mongo outage');
  process.kill(Number(process.env.MONGO_TEST_PROCESS_PID),'SIGCONT'); paused = false;
  let restored;
  for(let i=0;i<40;i++){restored=await request('/api/sku-groups',{headers});if(restored.status===200)break;await new Promise(resolve=>setTimeout(resolve,500));}
  assert.equal(restored.status,200); assert.deepEqual(restored.body.rows,[]);
  assert.equal((await request('/health/ready')).status,200);
  await page.getByRole('button', { name: 'Retry', exact: true }).filter({ visible: true }).first().click();
  await page.getByLabel('SKU Group Code *', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('SKU Group Code *', { exact: true }).inputValue(), 'UNSAVED-DRAFT');
  assert.equal(await page.getByLabel('SKU Group Name *', { exact: true }).inputValue(), 'Draft retained during outage');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add New', exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: 'tmp/mongo-reliability/sku-group-recovered.png' });
  await browser.close(); browser = undefined;
  let limited;
  for(let i=0;i<12;i++){limited=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:'invalid-fixture'})});if(limited.status===429)break;}
  assert.equal(limited.status,429);
  // Readiness must reject an incomplete deployment even when SELECT 1 works.
  const schemaClient = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 8000 });
  try {
    await schemaClient.connect();
    await schemaClient.query('DROP TABLE ci_login_rate_limit');
    const incomplete = await request('/health/ready');
    assert.equal(incomplete.status,503); assert.equal(incomplete.body.dependencies.postgres,'SCHEMA_UNAVAILABLE');
    assert.equal((await request('/health/live')).status,200);
    await schemaClient.query(await readFile('db/migrations/019_reliability_login.sql','utf8'));
    assert.equal((await request('/health/ready')).status,200);
  } finally { await schemaClient.end(); }
  await writeFile('tmp/mongo-reliability/http-acceptance.json',JSON.stringify({ endpoints: routes.length, counts, outcomes, scenarios:['authentication','origin denial','tenant denial','mounted GET routes','real Mongo process suspension','readiness degradation','independent PostgreSQL','Mongo recovery','failed-login throttling'] },null,2));
  console.log(`PASS HTTP reliability: ${routes.length} mounted API routes, auth/origin/tenant boundaries, live/ready, real Mongo outage/recovery, PostgreSQL independence, login throttling`);
} finally {
  if(browser)await browser.close();
  if(paused)process.kill(Number(process.env.MONGO_TEST_PROCESS_PID),'SIGCONT');
  if(server && server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await done;}
  if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
