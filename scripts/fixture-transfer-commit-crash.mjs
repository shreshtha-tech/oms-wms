import { transferCentralWmsStock } from '../inventory/wms-operations.js';
import { inventoryPool } from '../inventory/db.js';
const uri=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(uri.hostname)||!uri.pathname.startsWith('/codexqa_test_')||!process.send)throw new Error('Transfer crash fixture requires owned disposable database and IPC');
if(process.env.FIXTURE_TRANSFER_CHECKPOINT==='before-commit'){
 const db=inventoryPool(),connect=db.connect.bind(db);
 db.connect=async()=>{
  const client=await connect(),query=client.query;
  client.query=function(sql,...args){
   if(sql==='COMMIT'){
    process.send({checkpoint:'transfer-before-commit'});
    return new Promise(()=>{});
   }
   return query.call(this,sql,...args);
  };
  return client;
 };
}
process.once('message',async input=>{
 await transferCentralWmsStock(input);
 process.send({checkpoint:'transfer-committed'});
});
// Keep the committed process alive until the verifier kills it.
process.on('message',()=>{});
process.send({checkpoint:'ready'});
