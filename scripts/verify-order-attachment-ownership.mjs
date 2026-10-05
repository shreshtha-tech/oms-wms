import assert from 'node:assert/strict';
const mongoFixture=process.env.ORDER_ACTION_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_orderaction_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/order-maintenance.js')).default;
await store.insert('sale_orders',{order_no:'FIXTURE-A'});
const own=await store.insert('generic_records',{module:'order_attachment',order_no:'FIXTURE-A',file_name:'own'});
const other=await store.insert('generic_records',{module:'order_attachment',order_no:'FIXTURE-B',file_name:'other'});
const group=await store.insert('generic_records',{module:'customer-group',code:'PRESERVE'});
const call=async(ids)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method:'POST',query:{},body:{orderNo:'FIXTURE-A',action:'attachment-delete',ids}},res);return res;};
assert.equal((await call([group.id])).statusCode,403);
assert.ok(await store.findOne('generic_records',{id:group.id}));
assert.equal((await call([own.id,other.id])).statusCode,403);
assert.ok(await store.findOne('generic_records',{id:own.id}));assert.ok(await store.findOne('generic_records',{id:other.id}));
assert.equal((await call(['invalid'])).statusCode,400);
assert.equal((await call([own.id])).statusCode,200);
assert.equal(await store.findOne('generic_records',{id:own.id}),null);
console.log('PASS: attachment deletion rejects unrelated module/order/mixed selection and malformed identity; valid own attachment deleted. Mode shown by wrapper.');
if(!mongoFixture){
const raced=await store.insert('generic_records',{module:'order_attachment',order_no:'FIXTURE-A',file_name:'raced'});
let mutation;
const body={orderNo:'FIXTURE-A',action:'attachment-delete',get ids(){mutation ||= store.update('generic_records',raced.id,{order_no:'FIXTURE-B'});return [raced.id];}};
const response={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
await handler({method:'POST',query:{},body},response);await mutation;
assert.equal(response.statusCode,409,'Ownership-change deletion must not report full success');
assert.equal(response.value.deletedCount,0);
assert.ok(await store.findOne('generic_records',{id:raced.id}));

}
