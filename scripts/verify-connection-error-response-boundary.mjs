import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../inventory/connections.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('const wrap='),source.indexOf('export function connectionAuthorizationSetup'));
for(const scenario of ['null','message-getter','status-getter','code-getter','redaction','diagnostic','invalid-status','normal','database']){
 let error=Error('validation failed'),response,status;
 if(scenario==='null')error=null;
 if(scenario.endsWith('-getter'))Object.defineProperty(error,scenario.split('-')[0],{get(){throw Error('fixture-private-secret');}});
 if(scenario==='invalid-status')error.status=999;
 if(scenario==='normal')error.status=422;
 if(scenario==='database')error.code='ECONNREFUSED';
 const redact=value=>{if(scenario==='redaction')throw Error('fixture-private-secret');return value;};
 const diagnostic=async value=>{if(scenario==='diagnostic')throw Error('fixture-private-secret');return value;};
 const wrap=new Function('redact','safeAccountDiagnostic',body+'\nreturn wrap;')(redact,async(tenant,id,value)=>diagnostic(value));
 const res={status(code){status=code;return this;},json(value){response=value;return this;}};
 await wrap(async()=>{throw error;})({body:{fields:{}},params:scenario==='diagnostic'?{id:'account'}:{},inventoryTenantId:'tenant'},res);
 assert.equal(status,scenario==='normal'?422:400);
 assert.equal(typeof response.error,'string');
 assert.equal(response.error.includes('fixture-private'),false);
 if(['null','message-getter','redaction','diagnostic'].includes(scenario))assert.equal(response.error,'Connection operation failed');
 if(scenario==='database')assert.equal(response.error,'Connection database unavailable');
 if(scenario==='normal')assert.equal(response.error,'validation failed');
}
console.log('PASS connection error responses survive malformed exceptions, formatter failures and invalid HTTP status; ordinary validation messages preserved.');
