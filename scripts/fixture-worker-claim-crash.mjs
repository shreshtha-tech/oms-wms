import { inventoryPool } from '../inventory/db.js';
import { runInventoryTaskBatch } from '../inventory/workers.js';

const uri=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(uri.hostname)||!uri.pathname.startsWith('/codexqa_test_')||!process.send)throw new Error('Crash fixture requires owned disposable database and IPC');
const db=inventoryPool(),query=db.query;
if(process.env.FIXTURE_CRASH_CHECKPOINT==='stock-commit'){
 const connect=db.connect.bind(db);
 db.connect=async function(){
  const client=await connect(),original=client.query;
  client.query=function(sql,...args){
   if(typeof sql==='string'&&sql.startsWith("UPDATE ci_outbox SET status='done'")){
    process.send({checkpoint:'stock-committed-before-ack'});
    return new Promise(()=>{});
   }
   return original.call(this,sql,...args);
  };
  return client;
 };
}
db.query=function(sql,...args){
 if(typeof sql==='string'&&sql.startsWith('SELECT id FROM ci_channel_mapping')&&args[0]?.[2]==='gid://shopify/InventoryItem/claim-crash-fixture'){
  process.send({checkpoint:'claimed-before-business-query'});
  return new Promise(()=>{});
 }
 return query.call(this,sql,...args);
};
await runInventoryTaskBatch(1);
throw new Error('Crash fixture did not reach expected checkpoint');
