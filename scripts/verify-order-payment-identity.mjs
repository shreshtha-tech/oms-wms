import assert from 'node:assert/strict';
const mongoFixture=process.env.ORDER_ACTION_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_orderaction_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/order-maintenance.js')).default;
await store.insert('sale_orders',{order_no:'PAYMENT-FIXTURE'});
const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
await handler({method:'POST',query:{},body:{orderNo:'PAYMENT-FIXTURE',action:'payment',payment_type:'Fixture',module:'customer-group',order_no:'OTHER',id:10001,_id:'FORGED',amount:'12.50'}},res);
assert.equal(res.statusCode,201);
const rows=await store.find('generic_records',{orderNo:'PAYMENT-FIXTURE'});assert.equal(rows.length,1);
assert.equal(rows[0].module,'order_payment','Payment request cannot select another record module');
assert.equal(rows[0].order_no,'PAYMENT-FIXTURE');assert.notEqual(rows[0].id,10001);assert.equal(rows[0]._id,undefined);
assert.equal(rows[0].amount,'12.50');
console.log('PASS: payment metadata request cannot override module/order/storage identity; ordinary amount preserved. Mode shown by wrapper; financial posting unverified.');
