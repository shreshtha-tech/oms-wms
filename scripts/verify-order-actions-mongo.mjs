import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
assert.equal(process.env.ORDER_ACTION_MONGO_FIXTURE,'true');
try{
 await import('./verify-order-attachment-ownership.mjs');
 await import('./verify-order-payment-identity.mjs');
 const store=await import('../api/mongo.js');const client=new MongoClient(process.env.MONGODB_URI);
 try{
  await client.connect();const db=client.db(process.env.MONGODB_DB);
  const row=await store.insert('generic_records',{module:'order_attachment',order_no:'FIXTURE-A',file_name:'ownership-change'});
  await db.collection('generic_records').updateOne({id:row.id},{$set:{order_no:'FIXTURE-B'}});
  const removal=await store.remove('generic_records',row.id,{module:'order_attachment',order_no:'FIXTURE-A'});assert.equal(removal.deletedCount,0);
  assert.equal((await db.collection('generic_records').findOne({id:row.id})).order_no,'FIXTURE-B','Storage predicate preserves changed ownership');
  const payment=await db.collection('generic_records').findOne({orderNo:'PAYMENT-FIXTURE'});assert.equal(payment.module,'order_payment');assert.equal(payment.order_no,'PAYMENT-FIXTURE');
  console.log('PASS: disposable Mongo order-action regressions, independent payment readback and changed-ownership deletion predicate.');
 }finally{await client.close();await store.closeDataStore();}
}catch(error){console.error(error);process.exitCode=1;await (await import('../api/mongo.js')).closeDataStore();}
