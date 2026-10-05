import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {safeProviderStatus} from '../inventory/sync-attempts.js';
const source=await readFile(new URL('../inventory/connections.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function verifyAndSave'),source.indexOf('sellerConnectionsApi.use((req')).replace('export async function','async function');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const mode of ['retest','rotation','new']){
 let release,started=false;const writes=[];
 const gate=new Promise(resolve=>{release=resolve;});
 const prior={id:'account',platform:'fixture',encrypted_credentials:null};
 const run=new AsyncFunction('connectionAccount','validateConnectionFields','providerFetch','probeConnection','safeProviderStatus','saveAccount','inventoryPool','safeAccountFailure','redact','tryLogSyncAttempt','connectionView',body+`\nreturn verifyAndSave('tenant','fixture',${mode==='rotation'?"{token:'replacement'}":"{}"},${mode==='new'?"{}":"{id:'account'}"});`);
 const pending=run(async()=>prior,()=>({}),()=>{},async()=>{throw {providerStatus:401};},safeProviderStatus,async(...args)=>{writes.push({save:args});return prior;},()=>({query:async(...args)=>{writes.push({query:args});}}),async()=>{started=true;await gate;return {message:'safe',providerStatus:401};},value=>value,async()=>true,row=>row);
 try{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);
  assert.equal(writes.length,mode==='rotation'?0:1);
  if(mode==='retest')assert.equal(writes[0].query[1][2],'token_expired');
  if(mode==='new')assert.equal(writes[0].save[3].state,'token_expired');
 }finally{release();assert.equal((await pending).ok,false);}
}
console.log('PASS credential failure state persists before gated diagnostics; failed rotation preserves prior account.');
const feedSource=source.slice(source.indexOf('export async function armReadOnlyOrderFeed'),source.indexOf('async function saveAccount')).replace('export async function','async function');
let feedWrites=0,audits=0;
const feed=new AsyncFunction('connectionAccount','inventoryPool','callbackOrigin','provisionWebhooks','tryLogSyncAttempt','process',feedSource+"\nreturn armReadOnlyOrderFeed('tenant','account');");
const result=await feed(async()=>({platform:'shopify'}),()=>({query:async()=>{feedWrites++;}}),()=>{throw Error('fixture failure');},()=>{},async()=>{audits++;return false;},{env:{}});
assert.equal(result.state,'polling_fallback');assert.equal(feedWrites,2);assert.equal(audits,1);
console.log('PASS webhook setup retains persisted fallback result when optional audit is unavailable.');
