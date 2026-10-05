import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {safeProviderStatus} from '../inventory/sync-attempts.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const [file,entry,expected] of [['connection-observation.js','observeSellerConnections',1],['shopify-orders.js','pollShopifyOrderObservations',2]]){
 const source=(await readFile(new URL('../inventory/'+file,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export async function','async function');
 let release,diagnosticStarted=false;const writes=[];
 const gate=new Promise(resolve=>{release=resolve;});
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT *'))return {rows:[{id:'account',platform:'shopify'}]};
  if(sql.startsWith('SELECT'))return {rows:[]};
  writes.push({sql,args});return {rows:[]};
 }};
 const fail=async()=>{throw Object.assign(Error('fixture-private-secret'),{providerStatus:401});};
 const execute=new AsyncFunction('inventoryPool','currentCredentials','safeAccountFailure','safeProviderStatus','tryLogSyncAttempt',source+`\nreturn ${entry}('tenant');`);
 const pending=execute(()=>pool,fail,async()=>{diagnosticStarted=true;await gate;return {message:'safe',providerStatus:401};},safeProviderStatus,async()=>true);
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(diagnosticStarted,true);
  assert.equal(writes.length,expected,'Failure persistence must precede stalled diagnostics');
  assert.ok(writes.at(-1).sql.includes('connection_state'));
  assert.equal(JSON.stringify(writes).includes('fixture-private'),false);
  if(expected===2)assert.ok(writes[0].sql.includes('retry_after'));
 }finally{release();await pending;}
}
console.log('PASS current observation runtime: durable account failure and Shopify backoff precede stalled diagnostic processing.');
