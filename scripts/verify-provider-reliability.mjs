import assert from 'node:assert/strict';
import { providerCall } from '../reliability/provider-call.js';
const reply = status => ({ status, headers: new Headers() });
let calls = 0, waits = [];
const result = await providerCall(async () => reply(++calls < 3 ? 503 : 200), { provider: 'fixture', safeToRetry: true, sleep: async delay => waits.push(delay), random: () => 0.5 });
assert.equal(result.status, 200); assert.equal(calls, 3); assert.deepEqual(waits, [250,500]);
for (const status of [429,500,502,504]) {
  calls=0; waits=[];
  await providerCall(async()=>{calls++;const response=reply(calls<3?status:200);if(status===429)response.headers.set('retry-after','120');return response;},{provider:`status-${status}`,safeToRetry:true,sleep:async delay=>waits.push(delay),random:()=>0.5});
  assert.equal(calls,3);assert.ok(waits.every(delay=>delay<=5000));
  if(status===429)assert.deepEqual(waits,[5000,5000]);
}
for (const shape of [null,undefined,{status:'200'},{status:999}]) {
  calls=0;
  await assert.rejects(providerCall(async()=>{calls++;return shape;},{provider:'invalid-fixture',safeToRetry:true}),error=>error.status===502&&error.code==='PROVIDER_INVALID_RESPONSE');
  assert.equal(calls,1,'Malformed transport responses are not blindly retried');
}
for (const failure of [{code:'EAI_AGAIN'},{code:'ETIMEDOUT'},{name:'TimeoutError'}]) {
  calls=0;
  await assert.rejects(providerCall(async()=>{calls++;throw Object.assign(new Error('injected transient failure'),failure);},{provider:`failure-${failure.code||failure.name}`,safeToRetry:true,sleep:async()=>{}}));
  assert.equal(calls,3);
}
calls=0;
await assert.rejects(providerCall(async()=>{calls++;throw Object.assign(new Error('User cancelled'),{name:'AbortError'});},{provider:'cancelled-fixture',safeToRetry:true,sleep:async()=>{}}));
assert.equal(calls,1,'Explicit cancellation must not be retried');
for (const status of [400,401,403,422]) {
  calls = 0;
  await providerCall(async () => { calls++; return reply(status); }, { provider: 'fixture', safeToRetry: true });
  assert.equal(calls, 1);
}
calls = 0;
await providerCall(async () => { calls++; return reply(503); }, { provider: 'mutation-fixture', safeToRetry: false }); assert.equal(calls, 1);
calls = 0;
await assert.rejects(providerCall(async () => { calls++; throw Object.assign(new Error('network'), { code: 'ECONNRESET' }); }, { provider: 'network-fixture', safeToRetry: true, sleep: async () => {} })); assert.equal(calls, 3);
calls = 0;
for (let i = 0; i < 5; i++) await providerCall(async () => { calls++; return reply(503); }, { provider: 'circuit-fixture', safeToRetry: false });
await assert.rejects(providerCall(async () => { calls++; return reply(200); }, { provider: 'circuit-fixture' }), error => error.code === 'PROVIDER_CIRCUIT_OPEN'); assert.equal(calls, 5);
console.log('PASS provider reliability: bounded read retry, backoff, no auth/validation retry, no blind mutation retry, connection-reset exhaustion, open circuit');
