import assert from 'node:assert/strict';
const persistent=process.argv.includes('--mongo');
if(persistent){
  const uri=new URL(process.env.MONGODB_URI||'');
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(process.env.MONGODB_DB,'codexqa_reliability');
  assert.match(process.env.MONGO_TEST_PROCESS_PID||'',/^[1-9]\d*$/);
  process.env.DMILLS_REQUIRE_PERSISTENCE='true';
}else{
  process.env.MONGODB_URI='';
  process.env.DMILLS_REQUIRE_PERSISTENCE='false';
}
const {default:admin}=await import('../api/admin.js');
const {default:parity}=await import('../api/admin-parity.js');
const {insert,findOne,find,updateAdminIfVersion,waitForDataReady,closeDataStore}=await import('../api/mongo.js');
const invoke=async(handler,body,method=handler===admin?'PUT':'POST')=>{
  const res={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(body){this.body=body;return this;},end(){}};
  await handler({method,body,query:{},headers:{}},res);return res;
};
try{
if(persistent)assert.equal(await waitForDataReady(),'mongo');
for(const mode of ['generic','parity','mixed']){
  const row=await insert('admin_records',{type:'api-key',apiKey:'fixture-key',version:1});
  const attempts=await Promise.all(Array.from({length:20},(_,index)=>{
    const handler=mode==='generic'||(mode==='mixed'&&index%2===0)?admin:parity;
    return invoke(handler,{id:row.id,type:'api-key',action:'api-save',version:1,owner:`fixture-${index}`,allowedIps:`fixture-${index}`});
  }));
  assert.equal(attempts.filter(result=>result.statusCode===200).length,1);
  assert.equal(attempts.filter(result=>result.statusCode===409).length,19);
  const winner=attempts.find(result=>result.statusCode===200);
  const stored=await findOne('admin_records',{id:row.id});
  assert.equal(stored.version,2);
  assert.equal(stored.allowedIps,winner.body.allowedIps);
  assert.equal(stored.apiKey,'fixture-key');
  const stale=await invoke(parity,{action:'api-save',id:row.id,version:1,allowedIps:'stale'});
  assert.equal(stale.statusCode,409);
  assert.equal((await findOne('admin_records',{id:row.id})).allowedIps,stored.allowedIps);
  const audits=await find('admin_records',{type:'audit',entityId:row.id});
  assert.equal(audits.length,winner.body.owner?.startsWith('fixture-')?1:0);
  for(const handler of [admin,parity])for(const invalid of [undefined,null,'2',{},[],true,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
    const denied=await invoke(handler,{id:row.id,type:'api-key',action:'api-save',version:invalid,allowedIps:'invalid'});
    assert.equal(denied.statusCode,422);
    assert.equal((await findOne('admin_records',{id:row.id})).allowedIps,stored.allowedIps);
  }
}
for(const handler of [admin,parity]){
  const row=await insert('admin_records',{type:'api-key',apiKey:'fixture-legacy-key'});
  const saved=await invoke(handler,{id:row.id,type:'api-key',action:'api-save',version:0,allowedIps:'first'});
  assert.equal(saved.statusCode,200);assert.equal(saved.body.version,1);
  const stale=await invoke(handler,{id:row.id,type:'api-key',action:'api-save',version:0,allowedIps:'stale'});
  assert.equal(stale.statusCode,409);
  assert.equal((await findOne('admin_records',{id:row.id})).allowedIps,'first');
}
const legacy=await insert('admin_records',{type:'role',description:'fixture'});
assert.equal((await updateAdminIfVersion(legacy.id,undefined,{description:'updated'})).version,1);
assert.equal(await updateAdminIfVersion(legacy.id,undefined,{description:'stale'}),null);
for(const mixed of [false,true]){
  const row=await insert('admin_records',{type:'api-key',apiKey:'fixture-delete',version:1});
  assert.equal((await invoke(admin,{id:row.id,type:'api-key'},'DELETE')).statusCode,422);
  assert.equal((await invoke(admin,{id:row.id,type:'api-key',version:0},'DELETE')).statusCode,409);
  const attempts=await Promise.all(Array.from({length:20},(_,index)=>invoke(admin,{id:row.id,type:'api-key',version:1,owner:'fixture-update'},mixed&&index%2===0?'PUT':'DELETE')));
  assert.equal(attempts.filter(result=>result.statusCode===200).length,1);
  assert.ok(attempts.every(result=>[200,409,404].includes(result.statusCode)));
  const stored=await findOne('admin_records',{id:row.id});
  if(stored){assert.equal(stored.version,2);assert.equal(stored.owner,'fixture-update');}
  const audits=await find('admin_records',{type:'audit',entityId:row.id});
  assert.equal(audits.length,1);
}
console.log(`PASS controlled ${persistent?'real disposable Mongo':'memory'} 20-way generic/parity/mixed admin races: one write, nineteen conflicts, winner retained, key preserved, stale rejection and missing-version legacy transition; configured Atlas and crash atomicity unproven`);
}finally{await closeDataStore();}
