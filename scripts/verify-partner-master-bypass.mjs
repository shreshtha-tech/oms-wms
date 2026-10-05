import assert from 'node:assert/strict';
const mongoFixture=process.env.PARTNER_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_partner_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/partners.js')).default;
const call=async(method,body)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method,body},res);return res;};
for(const type of ['Customer','Transporter','Client']){
 const row=await store.insert('partners',{type,code:`FIXTURE-${type}`,name:'Preserve'});
 assert.equal((await call('DELETE',{id:row.id})).statusCode,501,`${type} shared deletion must be blocked`);
 assert.equal((await call('PUT',{id:row.id,type:'Other',name:'Forged'})).statusCode,501);
 assert.equal((await call('POST',{type,code:'Forged',name:'Forged'})).statusCode,501);
 assert.equal((await store.findOne('partners',{id:row.id})).name,'Preserve');
 const open=await store.insert('partners',{type:'Fixture',name:'Open'});
 assert.equal((await call('PUT',{id:open.id,type})).statusCode,501);
 assert.equal((await call('PUT',{id:open.id,partner_type:type})).statusCode,501);
 assert.equal((await call('DELETE',{id:[row.id,open.id]})).statusCode,400);
}
const legacy=await store.insert('partners',{type:'Fixture',partner_type:'Client',name:'Legacy client'});
assert.equal((await call('DELETE',{id:String(legacy.id)})).statusCode,501);
assert.equal((await call('POST',{type:' customer ',name:'Case disguise'})).statusCode,501);
const ordinary=await call('POST',{type:'Fixture',code:'ORDINARY',name:'Allowed'});assert.equal(ordinary.statusCode,201);
assert.equal((await call('PUT',{id:String(ordinary.value.id),name:'Updated'})).statusCode,200);
assert.equal((await store.findOne('partners',{id:ordinary.value.id})).name,'Updated');
assert.equal((await call('DELETE',{id:String(ordinary.value.id)})).statusCode,200);
assert.equal(await store.findOne('partners',{id:ordinary.value.id}),null);
console.log(`PASS: shared-partner protected mutations, conversion, legacy type and bulk identity checks; ordinary CRUD preserved. ${mongoFixture?'Disposable MongoDB':'Memory'} only.`);
await store.closeDataStore();
