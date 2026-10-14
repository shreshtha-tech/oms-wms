import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const failures = [];
let transport;
let calls = 0;
const exports = {};
new Function('exports', 'require', 'window', 'fetch', compiled)(exports,
  () => ({ recordRequestFailure: (...args) => failures.push(args) }),
  { location: { pathname: '/fixture' }, setTimeout, clearTimeout },
  (...args) => { calls++; return transport(...args); });
const body = { kind: 'json', value: { operationId: 'owned-fixture' } };
transport = async () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(exports.apiRequest('/mutation', 'POST', body), error => error.code === 'REQUEST_OUTCOME_UNKNOWN' && !error.message.includes('Please retry'));
assert.equal(calls, 1, 'Transport failure must not resend a mutation');
assert.equal(failures.length, 0, 'Unknown writes must not register a read retry');
transport = (_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
await assert.rejects(exports.apiRequest('/mutation', 'POST', body, 5), { code: 'REQUEST_OUTCOME_UNKNOWN', status: 504 });
await assert.rejects(exports.apiRequest('/read', 'GET', undefined, 5), error => error.status === 504 && error.message.includes('Please retry'));
assert.equal(typeof failures.at(-1)[2].retry, 'function');
const pageFailures = failures.length;
transport = async () => ({ status: 503, ok: false, json: async () => ({ error: 'Publication status unavailable' }) });
await assert.rejects(exports.apiGetLocal('/publication-status'), { status: 503, message: 'Publication status unavailable' });
assert.equal(failures.length, pageFailures + 1, 'An optional panel read clears a stale page-level failure for its own request');
assert.equal(failures.at(-1)[2], undefined, 'An optional panel read must not hide the whole page');
await assert.rejects(exports.apiGet('/critical-overview'), { status: 503, message: 'Publication status unavailable' });
assert.equal(failures.length, pageFailures + 2, 'A critical read still registers the page failure boundary');
assert.equal(typeof failures.at(-1)[2].retry, 'function');
transport = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('truncated response'); } });
await assert.rejects(exports.apiRequest('/mutation', 'POST', body), { code: 'REQUEST_OUTCOME_UNKNOWN', status: 502 });
transport = async () => ({ status: 409, ok: false, json: async () => ({ message: 'Revision conflict' }) });
await assert.rejects(exports.apiRequest('/mutation', 'POST', body), error => error.status === 409 && error.message === 'Revision conflict' && !error.code);
let release;
transport = () => new Promise(resolve => { release = resolve; });
const before = calls;
const first = exports.apiRequest('/mutation', 'POST', body);
const second = exports.apiRequest('/mutation', 'POST', body);
assert.equal(first, second);
assert.equal(calls, before + 1, 'Double click sends one in-flight write');
release({ status: 200, ok: true, json: async () => ({ id: 17 }) });
assert.deepEqual(await first, { id: 17 });
console.log('PASS: mutation response loss, timeout, malformed success, explicit conflict, read retry and in-flight deduplication');
