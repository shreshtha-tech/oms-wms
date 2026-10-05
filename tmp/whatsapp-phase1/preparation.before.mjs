import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../inventory/whatsapp.js',import.meta.url),'utf8');
const batch=source.slice(source.indexOf('export async function runWhatsAppBatch'),source.indexOf('export const whatsappPublic')).replace('export async function','async function');
const build=new Function('inventoryPool','transaction','whatsappReady','whatsappTemplatePayload','process','providerFetch',`${batch}\nreturn runWhatsAppBatch;`);
for(const stage of ['lines','template','serialization','send'])for(const attempt of [1,8]){
 const writes=[];let sends=0;
 const row={id:'alert',tenant_id:'tenant',order_id:'order',attempt_count:attempt};
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT seller_sku')){if(stage==='lines')throw Error('fixture-private-secret');return {rows:[]};}
  if(args?.[0]==='alert')writes.push({sql,args});
  return {rowCount:0,rows:[]};
 }};
 const template=()=>{if(stage==='template')throw Error('fixture-private-secret');if(stage==='serialization'){const circular={};circular.self=circular;return circular;}return {};};
 const run=build(()=>pool,async fn=>fn({query:async()=>({rows:[row]})}),()=>true,template,{env:{INVENTORY_ALLOWED_TENANT_ID:'tenant',WHATSAPP_GRAPH_VERSION:'v23.0',WHATSAPP_PHONE_NUMBER_ID:'123'}},()=>{});
 await run(10,async()=>{sends++;throw Error('fixture-private-secret');});
 assert.equal(sends,stage==='send'?1:0);
 assert.equal(writes.length,1);
 const [{sql,args}]=writes;
 assert.ok(sql.includes('claimed_at=NULL'));
 assert.ok(sql.includes("status='sending'"));
 assert.equal(JSON.stringify(writes).includes('fixture-private'),false);
 if(stage==='send')assert.ok(sql.includes("status='uncertain'"));
 else{assert.equal(args[1],attempt<8?'pending':'failed');assert.equal(args[2],attempt===1?'60':'3600');assert.ok(sql.includes('preparation failed before send'));}
}
console.log('PASS runtime-source WhatsApp preparation failures retry/terminate without sending; started-send exceptions remain uncertain, with safe diagnostics.');
