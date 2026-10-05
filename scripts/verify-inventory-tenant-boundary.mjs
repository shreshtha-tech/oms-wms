import assert from 'node:assert/strict';
import express from 'express';
import { inventoryPrivate } from '../inventory/http.js';

const tenant='tenant-boundary-fixture';
process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
const app=express();
app.use(express.json());
app.use('/api/inventory-sync',inventoryPrivate);
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/inventory-sync`;
try{
  const read=await fetch(`${base}/central/overview?tenantId=another-tenant`);
  assert.equal(read.status,403,'A read request must not select another tenant');
  assert.equal((await read.json()).error,'Inventory tenant denied');

  const write=await fetch(`${base}/central/products`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:'another-tenant',sku:'TENANT-ESCAPE',productName:'Must not persist'})});
  assert.equal(write.status,403,'A write request must not select another tenant');
  assert.equal((await write.json()).error,'Inventory tenant denied');

  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  const unconfigured=await fetch(`${base}/central/overview`);
  assert.equal(unconfigured.status,503,'Inventory routes must fail closed when no tenant is configured');
  assert.equal((await unconfigured.json()).error,'Inventory tenant is not configured');
  console.log('PASS inventory tenant boundary: query and body tenant substitution rejected; missing tenant configuration fails closed');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
