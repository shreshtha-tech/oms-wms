import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run before changing the sender; the saved source preserves the observed baseline.
const source=await readFile(new URL('../tmp/whatsapp-phase1/whatsapp.before.js',import.meta.url),'utf8');
const batch=source.slice(source.indexOf('export async function runWhatsAppBatch'),source.indexOf('export const whatsappPublic')).replace('export async function','async function');
const build=new Function('inventoryPool','transaction','whatsappReady','whatsappTemplatePayload','process','providerFetch',`${batch}\nreturn runWhatsAppBatch;`);
for(const stage of ['lines','template','serialization','config','fetch','response','accept-write','timeline']){
 const writes=[];let sends=0;
 const row={id:'alert',tenant_id:'tenant',order_id:'order',attempt_count:1};
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT seller_sku')){if(stage==='lines')throw Error('fixture private');return {rows:[]};}
  if(sql.includes("status='accepted'")&&stage==='accept-write')throw Error('fixture private');
  if(sql.startsWith('INSERT INTO ci_order_timeline')&&stage==='timeline')throw Error('fixture private');
  if(args?.[0]==='alert')writes.push({sql,args});
  return {rowCount:0,rows:[]};
 }};
 const template=()=>{if(stage==='template')throw Error('fixture private');if(stage==='serialization'){const x={};x.self=x;return x;}return {};};
 const env={INVENTORY_ALLOWED_TENANT_ID:'tenant',WHATSAPP_GRAPH_VERSION:stage==='config'?'invalid':'v23.0',WHATSAPP_PHONE_NUMBER_ID:'123'};
 const run=build(()=>pool,async fn=>fn({query:async()=>({rows:[row]})}),()=>true,template,{env},()=>{});
 await run(1,async()=>{sends++;if(stage==='fetch')throw Error('fixture private');return {ok:true,json:async()=>stage==='response'?{}:{messages:[{id:'wamid.fixture'}]}};});
 assert.equal(sends,['lines','template','serialization','config'].includes(stage)?0:1);
 const final=writes.at(-1);
 if(!sends)assert.equal(final.args[1],'pending');
 else assert.ok(final.sql.includes("status='uncertain'"));
}
console.log('PASS baseline: preparation/config failures retry pending; fetch/response/persistence exceptions enter uncertain catch (timeline failure cannot overwrite accepted due to status guard).');
