import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
assert.equal(process.env.TAX_MONGO_FIXTURE,'true');assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_tax_/);
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),'mongo');
const client=new MongoClient(process.env.MONGODB_URI);
try{
 await client.connect();const db=client.db(process.env.MONGODB_DB);assert.equal((await db.admin().command({hello:1})).setName,undefined);
 const code=await store.insert('tax_codes',{tax_code:'FIXTURE',is_active:'Active',percentage:5});
 const counters=await db.collection('_counters').find().sort({_id:1}).toArray();
 const handler=(await import('../api/tax-groups.js')).default;
 const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
 await handler({method:'POST',body:{code:'UNAVAILABLE',name:'Unavailable',applied_on:'Cost',start_date:'2026-10-02',status:'Active',tax_code_ids:[code.id]},query:{}},res);
 assert.equal(res.statusCode,503);assert.equal(await db.collection('generic_records').countDocuments({module:'tax-group'}),0);assert.equal(await db.collection('tax_group_codes').countDocuments(),0);
 assert.deepEqual(await db.collection('_counters').find().sort({_id:1}).toArray(),counters);
 const read={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
 await handler({method:'GET',query:{},body:{}},read);assert.equal(read.statusCode,503);
 console.log('PASS: standalone Tax Group save rejects 503 without metadata, mapping or counter changes.');
 console.log('PASS: standalone Tax Group reads reject 503 rather than claiming a coherent snapshot.');
}finally{await client.close();await store.closeDataStore();}
