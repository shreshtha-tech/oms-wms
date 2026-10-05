import assert from 'node:assert/strict';
import express from 'express';
process.env.MONGODB_URI='';
process.env.INVENTORY_DATABASE_URL='';
process.env.INVENTORY_ALLOWED_TENANT_ID='wms-input-fixture';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');
assert.equal(await store.waitForDataReady(),'memory');
const handler=(await import('../api/inventory-ops.js')).default;
const app=express();app.use(express.json());app.all('/inventory-ops',handler);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/inventory-ops`;
try{
 for(const method of ['POST','PUT'])for(const entity of ['moves','scan','intercompany','adjustments'])for(const quantity of [true,false,[1],[],{},null,'']){
  const response=await fetch(base,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({entity,quantity,sku_code:'fixture',from_warehouse:'A',to_warehouse:'B',masterSkuId:'fixture',locationId:'fixture',requestId:'fixture',reason:'fixture'})});
  assert.equal(response.status,400,`${method} ${entity} rejects malformed quantity before unavailable datastore access`);
 }
 for(const method of ['DELETE','PATCH']){
  const response=await fetch(base,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({entity:'moves',quantity:true})});
  assert.equal(response.status,405,'Unsupported methods cannot enter mutation handling');
 }
 console.log('PASS isolated HTTP WMS input boundary: 56 malformed quantities reject before datastore access; unsupported methods reject.');
}finally{await new Promise(resolve=>server.close(resolve));await store.closeDataStore();}
