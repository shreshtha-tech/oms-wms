import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
try{
 await import('./verify-vendor-boundaries.mjs');
 const client=new MongoClient(process.env.MONGODB_URI);
 try{
  await client.connect();const db=client.db(process.env.MONGODB_DB);
  assert.equal((await db.collection('vendors').indexes()).find(index=>index.name==='vendors_code_unique').unique,true);
  const store=await import('../api/mongo.js');
  const handler=(await import('../api/vendors.js')).default;
  const vendor=await db.collection('vendors').findOne({vendor_code:'DISJOINT'});
  await store.insert('purchase_orders',{po_no:'FIXTURE-HISTORY-PO',vendor_code:vendor.vendor_code,vendor:'Issued Supplier'});
  await store.insert('grn',{grn_no:'FIXTURE-HISTORY-GRN',vendor_code:vendor.vendor_code,vendor:'Issued Supplier'});
  const renamed={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
  await handler({method:'PUT',body:{id:vendor.id,vendor_name:'Current Supplier',vendor_code:'FORGED'},user:{username:'fixture'}},renamed);
  assert.equal(renamed.statusCode,200);
  assert.equal((await db.collection('vendors').findOne({id:vendor.id})).vendor_name,'Current Supplier');
  for(const collection of ['purchase_orders','grn']){
   const issued=await db.collection(collection).findOne({vendor_code:vendor.vendor_code});
   assert.equal(issued.vendor,'Issued Supplier');assert.equal(issued.vendor_code,'DISJOINT');
  }
  console.log('PASS: separate Mongo client confirms vendor rename and unchanged issued PO/GRN names and stable vendor code.');
  await db.collection('vendors').dropIndex('vendors_code_unique');
  await db.collection('vendors').insertMany([{id:10001,vendor_code:'HISTORICAL-DUP'},{id:10002,vendor_code:'HISTORICAL-DUP'}]);
  const response={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
  await handler({method:'POST',body:{vendor_code:'MUST-NOT-CREATE',vendor_name:'Blocked'},user:{username:'fixture'}},response);
  assert.equal(response.statusCode,503);
  assert.equal(await db.collection('vendors').countDocuments({vendor_code:'MUST-NOT-CREATE'}),0);
  assert.equal(await db.collection('vendors').countDocuments({vendor_code:'HISTORICAL-DUP'}),2);
  console.log('PASS: disposable Mongo vendor boundary tests, unique index readback, historical duplicate fail-closed with no insertion or data rewrite.');
 }finally{await client.close();}
 process.exit(0);
}catch(error){console.error(error);process.exit(1);}
