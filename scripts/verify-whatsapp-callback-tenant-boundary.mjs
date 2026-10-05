import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {metaErrorText} from '../inventory/whatsapp.js';
const source=await readFile(new URL('../inventory/whatsapp.js',import.meta.url),'utf8');
const callbackSource=source.slice(source.indexOf('export const whatsappPublic')).replace('export const','const');
for(const scenario of ['own','other','missing','bad-signature','absent-signature','bad-json','db-select','db-update','db-timeline','bad-tail']){
 let handler,response,transactions=0;const writes=[];
 const env={INVENTORY_ALLOWED_TENANT_ID:scenario==='missing'?undefined:'tenant-a',WHATSAPP_APP_SECRET:'fixture-secret',WHATSAPP_PHONE_NUMBER_ID:'123'};
 const row={id:'alert',tenant_id:scenario==='other'?'tenant-b':'tenant-a',order_id:'order',status:'accepted'};
 const express={Router:()=>({get:()=>{},post:(path,middleware,fn)=>{handler=fn;}}),raw:()=>{}};
 const transaction=async fn=>{transactions++;return fn({query:async(sql,args)=>{
  if(scenario==='db-select'&&sql.startsWith('SELECT'))throw Error('fixture-private-database-error');
  if(scenario==='db-update'&&sql.startsWith('UPDATE'))throw Error('fixture-private-database-error');
  if(scenario==='db-timeline'&&sql.startsWith('INSERT'))throw Error('fixture-private-database-error');
  if(sql.startsWith('SELECT')){
   assert.ok(sql.includes('tenant_id=$2'),'Callback lookup must include tenant boundary');
   assert.equal(args[1],'tenant-a');
   return {rows:row.tenant_id===args[1]?[row]:[]};
  }
  if(sql.startsWith('UPDATE')){assert.ok(sql.includes('tenant_id=$3'));assert.equal(args[2],'tenant-a');}
  writes.push({sql,args});return {rows:[]};
 }});};
 new Function('express','createHmac','timingSafeEqual','transaction','process','metaErrorText',callbackSource)(express,createHmac,timingSafeEqual,transaction,{env},metaErrorText);
 const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},statuses:[{id:'wamid.fixture',status:'delivered'}]}}]}]};
 if(scenario==='bad-tail')payload.entry[0].changes[0].value.statuses.push(null);
 const body=Buffer.from(scenario==='bad-json'?'{':JSON.stringify(payload));
 const signature=scenario==='absent-signature'?'':scenario==='bad-signature'?'sha256.'+'0'.repeat(64):'sha256='+createHmac('sha256',env.WHATSAPP_APP_SECRET).update(body).digest('hex');
 await handler({body,get:()=>signature},{sendStatus:code=>{response=code;}});
 assert.equal(response,scenario==='missing'?503:['bad-signature','absent-signature'].includes(scenario)?401:['bad-json','bad-tail'].includes(scenario)?400:scenario.startsWith('db-')?503:200);
 assert.equal(transactions,['missing','bad-signature','absent-signature','bad-json','bad-tail'].includes(scenario)?0:1);
 assert.equal(writes.length,scenario==='own'?2:scenario==='db-timeline'?1:0);
}
console.log('PASS runtime-source WhatsApp signed callbacks scope lookup to configured tenant; foreign alerts remain unchanged; missing tenant fails closed; database failures return 503 while malformed JSON returns 400.');
