import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { drainHttpServer } from '../reliability/http-shutdown.js';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const mode of ['complete', 'hung-request', 'hung-store', 'failed-store']) {
  let deadline = 0, forced = 0, idle = 0, errors = 0, stores = 0;
  const server = {
    close(callback) { if (mode !== 'hung-request') queueMicrotask(callback); },
    closeAllConnections() { forced++; },
    closeIdleConnections() { idle++; },
  };
  drainHttpServer({ server, deadlineMs: 20, onDeadline: () => deadline++, onError: () => errors++, closeStores: async () => { stores++; if (mode === 'hung-store') await new Promise(() => {}); if (mode === 'failed-store') throw new Error('private store details'); } });
  await pause(60);
  assert.equal(idle, 1);
  assert.equal(deadline, mode === 'complete' ? 0 : 1);
  assert.equal(forced, deadline);
  assert.equal(stores, mode === 'hung-request' ? 0 : 1);
  assert.equal(errors, mode === 'failed-store' ? 1 : 0);
}
const moduleUrl = new URL('../reliability/http-shutdown.js', import.meta.url).href;
const child = spawn(process.execPath, ['--input-type=module', '-e', `import { drainHttpServer } from ${JSON.stringify(moduleUrl)}; setInterval(()=>{},1000); drainHttpServer({server:{close(){},closeIdleConnections(){},closeAllConnections(){}},closeStores:async()=>{},deadlineMs:20});`], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' });
const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
try {
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 1, 'Actual child exits unsuccessfully at the deadline despite live handles');
} finally { clearTimeout(timer); }
console.log('PASS: completed drain clears deadline; hung requests, hung pools and failed cleanup reach one bounded termination.');
