import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { envelope, digest, validateEnvelope, consumeEvent } from '../inventory/domain-events.js';

const tenant='receipt-envelope-fixture',sku='FIXTURE-SKU';
const payload={grn_id:'1',request_id:'fixture-request',inbound_no:'FIXTURE',po_no:'FIXTURE-PO',location_id:randomUUID(),location_code:'FIXTURE-WH',draft_revision:1,payload_digest:'a'.repeat(64),source:'wms_inbound_create_edit',authorization:{digest:'b'.repeat(64),limits:{[sku]:10},legacy_received:{[sku]:2}},lines:[{sku,master_sku_id:randomUUID(),quantity:8,max_receivable_quantity:10}]};
const make=p=>envelope({tenantId:tenant,type:'inbound.receipt.requested.v1',key:[tenant,p.grn_id,p.request_id],payload:p});
assert.equal(validateEnvelope(make(payload),tenant).payload.lines[0].quantity,8);
let cases=0;
async function rejected(p){
 const event=make(p);
 assert.equal(event.payload_digest,digest(p),'Rejection must be schema validation, not a stale payload hash');
 await assert.rejects(()=>consumeEvent({query(){assert.fail('Malformed event must fail before database access');}},event,'fixture',tenant,()=>assert.fail('No business effect')),error=>error.code==='EVENT_INVALID');
 cases++;
}
for(const map of ['limits','legacy_received']){
 for(const value of [null,[],true,'invalid',-1]){
  const p=structuredClone(payload);p.authorization[map]=value;await rejected(p);
 }
 for(const value of [-1,true,null,'2',Number.MAX_SAFE_INTEGER+1,1.5]){
  const p=structuredClone(payload);p.authorization[map][sku]=value;await rejected(p);
 }
 for(const key of ['', 'x'.repeat(121)]){
  const p=structuredClone(payload);p.authorization[map][key]=0;await rejected(p);
 }
 const p=structuredClone(payload);p.authorization[map]=Object.fromEntries(Array.from({length:1201},(_,i)=>[`SKU-${i}`,0]));await rejected(p);
}
for(const legacy of [{[sku]:11},{'FOREIGN-SKU':1}]){
 const p=structuredClone(payload);p.authorization.legacy_received=legacy;await rejected(p);
}
const emptyLegacy=structuredClone(payload);emptyLegacy.authorization.legacy_received={};validateEnvelope(make(emptyLegacy),tenant);
const special=structuredClone(payload);special.lines[0].sku='__proto__';special.authorization.limits=JSON.parse('{"__proto__":10}');special.authorization.legacy_received=JSON.parse('{"__proto__":2}');validateEnvelope(make(special),tenant);
special.authorization.legacy_received={};validateEnvelope(make(special),tenant);
console.log(`PASS receipt envelopes: ${cases} malformed authorization cases reject before database/effects; valid empty and special-name quantity maps accepted.`);
