import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/serialPoll.ts', import.meta.url), 'utf8');
const exports = {};
const timers = new Map();
let sequence = 0;
new Function('exports', 'setTimeout', 'clearTimeout', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports,
  (callback, delay) => { assert.equal(delay, 3000); timers.set(++sequence, callback); return sequence; },
  id => timers.delete(id));
let calls = 0;
let release;
const stop = exports.serialPoll(() => { calls++; return new Promise(resolve => { release = resolve; }); }, 3000);
assert.equal(calls, 1);
assert.equal(timers.size, 0, 'A slow status request must not schedule overlapping reads');
release();
await Promise.resolve();
assert.equal(timers.size, 1);
const [id, callback] = [...timers][0];
timers.delete(id);
callback();
assert.equal(calls, 2);
assert.equal(timers.size, 0);
stop();
release();
await Promise.resolve();
assert.equal(timers.size, 0, 'Unmount during a request must prevent another read');
const stopFailed = exports.serialPoll(async () => { throw Error('temporary outage'); }, 3000);
await Promise.resolve();
assert.equal(timers.size, 1, 'A failed read remains eligible for bounded polling');
stopFailed();
assert.equal(timers.size, 0);
for (const name of ['InboundCreateEdit', 'InboundRealtime']) {
  const component = await readFile(new URL(`../src/eretail/modules/${name}.tsx`, import.meta.url), 'utf8');
  assert.ok(component.includes('serialPoll(refresh,'));
  assert.ok(!component.includes('setInterval'));
}
console.log('PASS: slow receipt reads cannot overlap, cleanup stops rescheduling, outages remain pollable, both screens use serial polling');
