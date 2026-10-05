import assert from 'node:assert/strict';
assert.equal(process.env.TAX_MONGO_FIXTURE,'true');assert.equal(new URL(process.env.MONGODB_URI).hostname,'127.0.0.1');assert.match(process.env.MONGODB_DB,/^codexqa_tax_/);
const store=await import('../api/mongo.js');assert.equal(await store.waitForDataReady(),'mongo');
const handler=(await import('../api/tax-groups.js')).default;
process.on('message',async task=>{
 try{
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;},setHeader(){}};
  await handler({method:task.method,body:task.body,query:{}},res);
  await store.closeDataStore();process.send({status:res.statusCode},()=>process.disconnect());
 }catch{await store.closeDataStore();process.send({status:500},()=>process.disconnect());}
});
process.send({ready:true});
