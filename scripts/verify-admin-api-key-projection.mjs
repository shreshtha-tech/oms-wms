import assert from 'node:assert/strict';
delete process.env.MONGODB_URI;delete process.env.MONGODB_DB;
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const [{default:admin},{default:parity},{insert,findOne}]=await Promise.all([import('../api/admin.js'),import('../api/admin-parity.js'),import('../api/mongo.js')]);
const topSecret='synthetic-top-secret',nestedSecret='synthetic-nested-secret',keySecret='synthetic-key-secret';
const saved=await insert('admin_records',{type:'api-key',owner:'Fixture Owner',apiKey:keySecret,status:'Active',version:1,permissions:[{name:'inventory',access:true,locations:['fixture',{privateToken:nestedSecret}],privateToken:nestedSecret}],privateToken:topSecret});
const invoke=async(handler,query)=>{
 const res={code:200,status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;},end(){}};
 await handler({method:'GET',query,body:{},headers:{},user:{username:'fixture'}},res);
 assert.equal(res.code,200);return res.body;
};
const list=(await invoke(admin,{type:'api-key'})).find(row=>row.id===saved.id);
const catalog=(await invoke(parity,{action:'api-catalog'})).keys.find(row=>row.id===saved.id);
for(const response of [list,catalog]){
 assert.equal(response.apiKey,'[stored]');assert.equal(response.owner,'Fixture Owner');assert.equal(response.version,1);
 assert.deepEqual(response.permissions,[{name:'inventory',access:true,locations:['fixture']}]);
 for(const secret of [topSecret,nestedSecret,keySecret])assert.equal(JSON.stringify(response).includes(secret),false);
}
assert.equal((await findOne('admin_records',{id:saved.id})).privateToken,topSecret,'Projection must not mutate historical records');
console.log('PASS Admin API-key projection: both list/catalog expose only UI fields and redact top-level/nested unknown secrets without rewriting storage.');
