import assert from 'node:assert/strict';
const mongoFixture=process.env.TAX_MONGO_FIXTURE==='true';
if(mongoFixture){assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_tax_/);}
else process.env.MONGODB_URI='';
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),mongoFixture?'mongo':'memory');
const handler=(await import('../api/taxcodes.js')).default;
const call=async(percentage,tax_code)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method:'POST',body:{tax_code,tax_code_type:'GST',tax_nature:'Central Cess',start_date:'2026-10-02',percentage}},res);return res;};
for(const [i,value] of [false,true,[],[5],{},'   '].entries())assert.equal((await call(value,`BAD${i}`)).statusCode,400,'Non-numeric JSON/blank percentage must reject');
for(const [i,value] of [0,'0','12.5',100].entries())assert.equal((await call(value,`GOOD${i}`)).statusCode,201);
assert.equal((await store.find('tax_codes')).length,4);
console.log(`PASS: tax percentage rejects coercible JSON/blank values; explicit numeric zero/decimal/100 persist. ${mongoFixture?'Disposable MongoDB':'Memory'} only.`);
const existing=(await store.find('tax_codes'))[0];
const update=async(fields)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};await handler({method:'PUT',body:{id:String(existing.id),tax_code:existing.tax_code,...fields}},res);return res;};
const changed=await update({percentage:'7.5',_id:'FORGED'});assert.equal(changed.statusCode,200);
assert.equal((await store.findOne('tax_codes',{id:existing.id})).percentage,7.5,'String identity must update the resolved numeric tax record');
assert.equal((await store.findOne('tax_codes',{id:existing.id}))._id,undefined);
assert.equal((await update({percentage:false})).statusCode,400);

console.log(`PASS: tax update identity, caller _id and invalid-value checks. ${mongoFixture?'Disposable MongoDB':'Memory'} only.`);
await store.closeDataStore();
