import assert from 'node:assert/strict';
const mongoFixture=process.env.TAX_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_tax_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/tax-groups.js')).default;
const call=async(method,body)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method,body,query:{}},res);return res;};
const a=await store.insert('tax_codes',{tax_code:'FIXTUREA',percentage:5,is_active:'Active'}),b=await store.insert('tax_codes',{tax_code:'FIXTUREB',percentage:12,is_active:'Active'});
const base={code:'FIXTURE',name:'Fixture',applied_on:'Cost',start_date:'2026-10-02',status:'Active'};
const created=await call('POST',{...base,tax_code_ids:[a.id]});assert.equal(created.statusCode,201);
const results=await Promise.all([call('PUT',{...base,id:created.value.id,tax_code_ids:[a.id]}),call('PUT',{...base,id:created.value.id,tax_code_ids:[b.id]})]);
const rows=await store.find('tax_group_codes',{group_id:created.value.id});
const coherent=rows.length===1&&[a.id,b.id].includes(rows[0].tax_code_id);
console.log(JSON.stringify({evidenceLayer:mongoFixture?'disposable MongoDB':'isolated memory',statuses:results.map(r=>r.statusCode),componentIds:rows.map(r=>r.tax_code_id),coherentReplacement:coherent}));
assert.equal(coherent,true,'Simultaneous replacements must leave one complete requested component set');

if(mongoFixture){
 const {MongoClient}=await import('mongodb');const client=new MongoClient(process.env.MONGODB_URI);
 try{
  await client.connect();const db=client.db(process.env.MONGODB_DB);
  const {fork}=await import('node:child_process');
  const start=()=>{
   const child=fork('scripts/tax-group-save-fixture-child.mjs',[],{stdio:['ignore','ignore','ignore','ipc']});
   const ready=new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',message=>{if(message.ready)resolve();else reject(new Error('Fixture child not ready'));});});
   const exited=new Promise(resolve=>child.once('exit',resolve));
   return {child,ready,exited};
  };
  const processes=[start(),start()];
  try{
   await Promise.all(processes.map(item=>item.ready));
   const answers=processes.map(item=>new Promise(resolve=>item.child.once('message',resolve)));
   processes[0].child.send({method:'PUT',body:{...base,name:'Process A',id:created.value.id,tax_code_ids:[a.id]}});
   processes[1].child.send({method:'PUT',body:{...base,name:'Process B',id:created.value.id,tax_code_ids:[b.id]}});
   assert.deepEqual((await Promise.all(answers)).map(answer=>answer.status),[200,200]);
   await Promise.all(processes.map(item=>item.exited));
   const metadata=await db.collection('generic_records').findOne({id:created.value.id});
   const mappings=await db.collection('tax_group_codes').find({group_id:created.value.id}).toArray();
   assert.equal(mappings.length,1);
   assert.equal(mappings[0].tax_code_id,metadata.name==='Process A'?a.id:b.id);
   console.log('PASS: separate Node processes leave metadata and mappings from one coherent Tax Group replacement.');
  }finally{for(const item of processes)if(item.child.exitCode===null)item.child.kill('SIGTERM');await Promise.all(processes.map(item=>item.exited));}
  const creators=[start(),start()];
  try{
   await Promise.all(creators.map(item=>item.ready));
   const answers=creators.map(item=>new Promise(resolve=>item.child.once('message',resolve)));
   for(const item of creators)item.child.send({method:'POST',body:{...base,code:'PROCESSCREATE',name:'Process Create',tax_code_ids:[a.id]}});
   assert.deepEqual((await Promise.all(answers)).map(answer=>answer.status).sort(),[201,409]);
   await Promise.all(creators.map(item=>item.exited));
   const matches=await db.collection('generic_records').find({module:'tax-group',code:'PROCESSCREATE'}).toArray();assert.equal(matches.length,1);
   assert.equal(await db.collection('tax_group_codes').countDocuments({group_id:matches[0].id}),1);
   console.log('PASS: separate-process duplicate group creation commits once and conflicts once.');
  }finally{for(const item of creators)if(item.child.exitCode===null)item.child.kill('SIGTERM');await Promise.all(creators.map(item=>item.exited));}
  const {Collection}=await import('mongodb');
  const oldFind=Collection.prototype.find;
  let observedRead,continueRead;
  const reached=new Promise(resolve=>{observedRead=resolve;});
  const gate=new Promise(resolve=>{continueRead=resolve;});
  let intercepted=false;
  Collection.prototype.find=function(filter,options){
   const cursor=oldFind.call(this,filter,options);
   if(!intercepted&&this.collectionName==='generic_records'&&filter?.module==='tax-group'&&options?.session){
    intercepted=true;const oldArray=cursor.toArray.bind(cursor);
    cursor.toArray=async()=>{const result=await oldArray();observedRead();await gate;return result;};
   }
   return cursor;
  };
  const oldMetadata=await db.collection('generic_records').findOne({id:created.value.id});
  const oldMapping=await db.collection('tax_group_codes').findOne({group_id:created.value.id});
  let reading;
  try{
   reading=store.readTaxGroupSnapshot();
   let timer;await Promise.race([reached,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Reader interception timeout')),5000);})]).finally(()=>clearTimeout(timer));
   const nextCode=oldMapping.tax_code_id===a.id?b.id:a.id;
   assert.equal((await call('PUT',{...base,id:created.value.id,name:'Snapshot New',tax_code_ids:[nextCode]})).statusCode,200);
   continueRead();const [snapshotGroups,snapshotMappings]=await reading;
   assert.equal(snapshotGroups.find(row=>row.id===created.value.id).name,oldMetadata.name);
   assert.equal(snapshotMappings.find(row=>row.group_id===created.value.id).tax_code_id,oldMapping.tax_code_id);
   assert.equal((await db.collection('generic_records').findOne({id:created.value.id})).name,'Snapshot New');
   assert.equal((await db.collection('tax_group_codes').findOne({group_id:created.value.id})).tax_code_id,nextCode);
   console.log('PASS: paused metadata read retains old mapping snapshot across a committed concurrent replacement.');
  }finally{continueRead();Collection.prototype.find=oldFind;if(reading)await reading.catch(()=>{});}
  const groupId=created.value.id;
  const beforeGroup=await db.collection('generic_records').findOne({id:groupId});
  const beforeMappings=await db.collection('tax_group_codes').find({group_id:groupId}).sort({id:1}).toArray();
  const beforeCounters=await db.collection('_counters').find().sort({_id:1}).toArray();
  const rejected=beforeMappings[0].tax_code_id===a.id?b.id:a.id;
  await db.command({collMod:'tax_group_codes',validator:{tax_code_id:{$ne:rejected}},validationAction:'error'});
  const failed=await call('PUT',{...base,id:groupId,name:'Must Roll Back',tax_code_ids:[rejected]});
  assert.equal(failed.statusCode,500);
  assert.deepEqual(await db.collection('generic_records').findOne({id:groupId}),beforeGroup);
  assert.deepEqual(await db.collection('tax_group_codes').find({group_id:groupId}).sort({id:1}).toArray(),beforeMappings);
  assert.deepEqual(await db.collection('_counters').find().sort({_id:1}).toArray(),beforeCounters);
  const failedCreate=await call('POST',{...base,code:'FAILCREATE',name:'Fail Create',tax_code_ids:[rejected]});assert.equal(failedCreate.statusCode,500);
  assert.equal(await db.collection('generic_records').countDocuments({module:'tax-group',code:'FAILCREATE'}),0);
  assert.deepEqual(await db.collection('_counters').find().sort({_id:1}).toArray(),beforeCounters);
  await db.command({collMod:'tax_group_codes',validator:{}});
  assert.equal((await call('PUT',{...base,id:groupId,name:'Recovered',tax_code_ids:[rejected]})).statusCode,200);
  assert.equal((await db.collection('tax_group_codes').findOne({group_id:groupId})).tax_code_id,rejected);
  console.log('PASS: injected mapping validation failure rolls back metadata, mappings and counters; failed create leaves no group; recovery succeeds.');
 }finally{await client.close();}
}
assert.equal((await call('PUT',{...base,id:999999,tax_code_ids:[a.id]})).statusCode,404);
assert.equal((await call('POST',{...base,code:'INVALID',name:'Invalid',tax_code_ids:[999999]})).statusCode,400);
await store.closeDataStore();
