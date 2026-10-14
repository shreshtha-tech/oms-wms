// Disposable browser fixture for the real SKU Import component. No application
// server, credentials, configured MongoDB or PostgreSQL is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const requests = [];
const result = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Screen from './src/eretail/masters/SkuImport.tsx';createRoot(document.getElementById('root')).render(<Screen/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  plugins: [{ name: 'isolated-layout-and-http', setup(b) {
    b.onResolve({ filter: /^(\.\.\/Shell|\.\.\/EnquiryScreen|\.\.\/parts|\.\.\/\.\.\/lib\/api)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => {
      if (a.path.endsWith('/api')) return { contents: `export async function apiGet(path){const r=await fetch(path);return r.json()}export async function apiSend(path,method,body){const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message||data.error);return data}`, loader: 'js' };
      if (a.path.endsWith('/parts')) return { contents: `import React from 'react';export function Toast({msg}){return <div role="alert">{msg}</div>}`, loader: 'jsx', resolveDir: root };
      if (a.path.endsWith('/Shell')) return { contents: `import React from 'react';export default function Shell({children}){return <main>{children}</main>}`, loader: 'jsx', resolveDir: root };
      return { contents: `import React from 'react';export default function EnquiryScreen(){return <div>History enquiry</div>}`, loader: 'jsx', resolveDir: root };
    });
  } }],
});
const script = result.outputFiles[0].text;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); return res.end(script); }
  if (req.url.startsWith('/api/')) {
    let raw = '';for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, method: req.method, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/sku-imports' && req.method === 'GET') return res.end(JSON.stringify({ attributeSets: ['Fixture attributes'], importTypes: ['CreateUpdate'] }));
    if (req.url === '/api/sku-imports' && req.method === 'POST') {
      res.statusCode = 501;
      return res.end(JSON.stringify({ error: 'SKU_IMPORT_PROCESSOR_UNAVAILABLE', message: 'SKU import processing is not connected. No SKU changes or processed import record were created.' }));
    }
    res.statusCode = 500; return res.end(JSON.stringify({ error: 'Unexpected API access in isolated fixture' }));
  }
  res.setHeader('content-type','text/html');res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
let browser;
try {
  server.listen(0, '127.0.0.1');await new Promise((resolve, reject) => { server.once('listening', resolve);server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();const pageErrors = [];page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('SKU import processing is currently unavailable.', { exact: false }).waitFor();
  await page.getByLabel('Attribute Set *').selectOption({ label: 'Fixture attributes' });
  await page.locator('input[type="file"]').setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('sku_code,name\nFIXTURE,Must never be written\n') });
  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: 'No SKU changes or processed import record were created.' }).waitFor();
  const posts = requests.filter(r => r.method !== 'GET');
  assert.deepEqual(posts, [{ path: '/api/sku-imports', method: 'POST', body: { file_name: 'fixture.csv', attribute_set: 'Fixture attributes', import_type: 'CreateUpdate' } }]);
  assert.ok(requests.every(r => r.path === '/api/sku-imports'), 'Import must never read or mutate individual SKUs');
  assert.deepEqual(pageErrors, []);
  console.log('PASS SKU import browser boundary: actual component sends only an import request, shows unavailable outcome, and never accesses individual SKUs. Layout and HTTP client are fixture adapters; no configured store was used.');
} finally { if (browser) await browser.close();await new Promise(resolve => server.close(resolve)); }
