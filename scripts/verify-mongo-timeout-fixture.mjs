import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { createMongoConnection } from '../api/mongo-connection.js';
import { sendDatabaseUnavailable } from '../api/mongo.js';
assert.equal(new URL(process.env.MONGODB_URI||'').hostname,'127.0.0.1');
assert.ok(process.env.MONGO_TEST_PROCESS_PID,'Use disposable Mongo wrapper');
const control=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:8000});
const manager=createMongoConnection({uri:process.env.MONGODB_URI,database:process.env.MONGODB_DB});
let enabled=false;
try{
 await control.connect(); const db=await manager.connect();
 await db.command({insert:'deadline_fixture',documents:[{_id:1,value:42}]});
 await control.db('admin').command({configureFailPoint:'maxTimeAlwaysTimeOut',mode:'alwaysOn'});enabled=true;
 let timeout;
 try{await manager.run(()=>db.command({find:'deadline_fixture',filter:{},maxTimeMS:10}));}catch(error){timeout=error;}
 assert.equal(timeout?.status,504);assert.equal(timeout.code,'DATABASE_TIMEOUT');assert.equal(manager.status().state,'READY');
 const response={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 assert.equal(sendDatabaseUnavailable(response,timeout),true);assert.equal(response.code,504);assert.equal(response.body.database,'mongodb');
 await control.db('admin').command({configureFailPoint:'maxTimeAlwaysTimeOut',mode:'off'});enabled=false;
 assert.equal((await db.collection('deadline_fixture').findOne({_id:1})).value,42);
 await manager.probe();assert.equal(manager.status().state,'READY');
 console.log('PASS real Mongo maxTimeMS: deadline classified 504 at shared API boundary, no false rows, healthy pool retained, durable value unchanged, subsequent reads recovered');
}finally{
 if(enabled)await control.db('admin').command({configureFailPoint:'maxTimeAlwaysTimeOut',mode:'off'});
 await manager.close();await control.close();
 const{closeDataStore}=await import('../api/mongo.js');await closeDataStore();
}
