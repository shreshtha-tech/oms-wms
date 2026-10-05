import assert from 'node:assert/strict';
import { safeAccountDiagnostic, safeAccountFailure } from '../inventory/sync-attempts.js';

const empty = { query: async () => ({ rows: [] }) };
const withheld = { message: 'Diagnostic withheld: diagnostic processing unavailable', code: 'DIAGNOSTIC_UNAVAILABLE' };
const cyclic = {}; cyclic.self = cyclic;
const getter = { get message() { throw new Error('unsafe diagnostic'); } };
const deep={};let cursor=deep;for(let index=0;index<30;index++){cursor.next={};cursor=cursor.next;}
for (const diagnostic of [cyclic, getter,{value:1n},{payload:Buffer.from('fixture-private-binary')},{message:'x'.repeat(65000)},Array.from({length:1001},()=>({value:'fixture'})),deep]) {
  assert.deepEqual(await safeAccountDiagnostic('fixture', 'fixture', diagnostic, empty), withheld);
}
assert.deepEqual(await safeAccountDiagnostic('fixture', 'fixture', { message: 'unsafe input' }, {
  query: async () => { throw new Error('unsafe database diagnostic'); },
}), withheld);
assert.deepEqual(await safeAccountDiagnostic('fixture', 'fixture', { token: 'fixture-secret', message: 'ordinary error' }, empty), {
  token: '[redacted]', message: 'ordinary error',
});
for(const thrown of [null,undefined,getter,{message:{toString(){throw new Error('unsafe conversion');}},get providerStatus(){throw new Error('unsafe status');}}]){
 const safe=await safeAccountFailure('fixture','fixture',thrown,empty);
 assert.match(safe.message,/withheld/i);assert.equal(safe.providerStatus,0);
}
assert.deepEqual(await safeAccountFailure('fixture','fixture',Object.assign(new Error('ordinary error'),{providerStatus:401}),empty),{message:'ordinary error',providerStatus:401});
console.log('PASS isolated diagnostic boundary: lookup/redaction and malformed thrown values cannot escape; ordinary redaction and provider status preserved.');
