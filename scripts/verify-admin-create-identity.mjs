import assert from 'node:assert/strict';
delete process.env.MONGODB_URI;delete process.env.MONGODB_DB;
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const [{default:handler},{find,findOne}]=await Promise.all([import('../api/admin.js'),import('../api/mongo.js')]);
const invoke=async(body,method='POST',query={})=>{
 const response={code:200,status(value){this.code=value;return this;},setHeader(){},json(value){this.body=value;return this;},end(){}};
 await handler({method,body,query,headers:{},user:{username:'fixture'}},response);
 return response;
};
const source={id:0,type:'api-key',owner:'Synthetic Owner',apiKey:'synthetic-nonsecret',expiryDate:'2027-01-01',status:'Active',permissions:[]};
const created=await invoke(source);
assert.equal(created.code,201);assert.ok(Number.isSafeInteger(created.body.id)&&created.body.id>0);
assert.equal(created.body.apiKey,'[stored]');
assert.equal((await findOne('admin_records',{id:created.body.id})).apiKey,source.apiKey);
assert.equal((await invoke({},'GET',{type:'api-key'})).body.find(row=>row.id===created.body.id).apiKey,'[stored]');
const activated=await invoke({id:created.body.id,type:'api-key',version:created.body.version,status:'InActive'},'PUT');
assert.equal(activated.code,200);assert.equal(activated.body.status,'InActive');assert.equal(activated.body.version,2);
assert.equal((await invoke({id:created.body.id,type:'api-key',version:created.body.version,status:'Active'},'PUT')).code,409);
for(const id of [1,'1',true,[],{},-1,1.5]){
 const response=await invoke({...source,id,owner:'Unauthorized identity'});
 assert.equal(response.code,400);
}
assert.equal((await find('admin_records',{type:'api-key'})).filter(row=>row.owner==='Unauthorized identity').length,0);
for(const body of [null,[],true])assert.equal((await invoke(body)).code,422);
console.log('PASS Admin create identity: id-zero form obtains a server ID, API key stays masked, caller-chosen identities and malformed bodies create no record.');
