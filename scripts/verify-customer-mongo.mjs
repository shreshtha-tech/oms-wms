import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_customer_/);
const client=new MongoClient(process.env.MONGODB_URI);
try{
 await client.connect();const db=client.db(process.env.MONGODB_DB);
 await db.createCollection('partners',{validator:{$and:[{customer_code:{$type:'string'}},{code:{$type:'string'}},{name:{$ne:'Reject Fixture'}}]},validationAction:'error'});
 const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),'mongo');
 const handler=(await import('../api/customers.js')).default;
 const call=async(body,method='POST')=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method,body,user:{username:'fixture'}},res);return res;};
 const created=await call({customer_name:'Complete Fixture',type:'1 - B2C'});
 assert.equal(created.statusCode,201,'Customer must satisfy complete-code validator on initial insert');
 const row=await db.collection('partners').findOne({id:created.value.id});assert.equal(row.code,`CUS${String(row.id).padStart(3,'0')}`);assert.equal(row.customer_code,row.code);
 const count=await db.collection('partners').countDocuments();
 assert.equal((await call({customer_name:'Reject Fixture',type:'1 - B2C'})).statusCode,500);
 assert.equal(await db.collection('partners').countDocuments(),count,'Failed insert must leave no partial customer');
 const burst=await Promise.all(Array.from({length:10},(_,i)=>call({customer_name:`Burst ${i}`,type:'1 - B2C'})));assert.ok(burst.every(r=>r.statusCode===201));
 const rows=await db.collection('partners').find().toArray();assert.equal(new Set(rows.map(r=>r.code)).size,rows.length);assert.ok(rows.every(r=>r.code===r.customer_code));
 const contact=await call({customer_name:'Contact One',type:'1 - B2C',primary_contact:'fixture-primary',shipping_phone:'delivery-one'});assert.equal(contact.statusCode,201);
 assert.equal((await call({customer_name:'Contact Two',type:'1 - B2C',primary_contact:'fixture-primary',shipping_phone:'delivery-two'})).statusCode,409);
 assert.equal((await call({id:created.value.id,primary_contact:'fixture-primary'},'PUT')).statusCode,409);
 assert.equal((await db.collection('partners').findOne({id:contact.value.id})).contact,'fixture-primary');
 console.log('PASS: duplicate primary contact rejects on create/update and separate Mongo client confirms stored contact field.');
 console.log('PASS: disposable Mongo initial customer insert has generated code, rejection leaves no partial row, concurrent creations have distinct codes.');
 await store.closeDataStore();await client.close();process.exit(0);
}catch(error){console.error(error);await client.close();process.exit(1);}
