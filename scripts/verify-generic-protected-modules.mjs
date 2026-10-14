import assert from 'node:assert/strict';
const mongoFixture=process.env.GENERIC_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_generic_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/generic.js')).default;
const call=async(method,body)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method,body},res);return res;};
const modules=['tax-group','tax-category','customer-group','vouchers','other-masters-fixture','sales-promotion','sku-group','sku-company-link','org-hierarchy','location','sku-import'];
let assertions=0;
for(const module of modules){
 const protectedRow=await store.insert('generic_records',{module,code:'FIXTURE',name:'Preserve'});
 const openRow=await store.insert('generic_records',{module:'fixture-open',code:'OTHER',name:'Open'});
 for(const [method,body] of [['POST',{module}],['PUT',{id:protectedRow.id,module:'fixture-open',name:'Forged'}],['DELETE',{id:protectedRow.id,module:'fixture-open'}],['PUT',{id:openRow.id,extra:{module}}]]){
  assert.equal((await call(method,body)).statusCode,501,`${module} ${method} must fail closed`);assertions++;
 }
 assert.equal((await store.findOne('generic_records',{id:protectedRow.id})).name,'Preserve');
 assert.equal((await store.findOne('generic_records',{id:openRow.id})).module,'fixture-open');
}
const created=await call('POST',{module:'fixture-open',code:'CREATE',name:'Allowed'});assert.equal(created.statusCode,201);
assert.equal((await call('PUT',{id:created.value.id,name:'Updated'})).statusCode,200);
assert.equal((await call('DELETE',{id:created.value.id})).statusCode,200);
console.log(`PASS: ${assertions} protected generic mutation paths fail closed; records preserved; ordinary fixture CRUD still works. ${mongoFixture?'Disposable MongoDB':'Memory'} only.`);
await store.closeDataStore();
