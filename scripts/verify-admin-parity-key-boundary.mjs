import assert from 'node:assert/strict';
process.env.MONGODB_URI='';
process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const {default:handler}=await import('../api/admin-parity.js');
const {insert,findOne}=await import('../api/mongo.js');
const invoke=async(method,body={},query={})=>{
  const res={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(value){this.body=value;return this;},end(){}};
  await handler({method,body,query,headers:{},user:{username:'fixture'}},res);
  assert.equal(res.statusCode,200);return res.body;
};
const short=await insert('admin_records',{type:'api-key',apiKey:'tiny',version:1});
const empty=await insert('admin_records',{type:'api-key',apiKey:'',version:1});
const created=await invoke('POST',{action:'api-save',permissions:['fixture']});
const stored=await findOne('admin_records',{id:created.id});
assert.match(stored.apiKey,/^[a-f0-9]{48}$/);
assert.equal(created.apiKey,'[stored]');
const updated=await invoke('POST',{action:'api-save',id:created.id,version:created.version,permissions:['updated'],apiKey:'untrusted-replacement'});
assert.equal(updated.apiKey,'[stored]');
assert.equal(updated.version,2);
assert.deepEqual(updated.permissions,['updated']);
assert.equal((await findOne('admin_records',{id:created.id})).apiKey,stored.apiKey);
const catalog=await invoke('GET',{}, {action:'api-catalog'});
assert.equal(catalog.keys.find(row=>row.id===short.id).apiKey,'[stored]');
assert.equal(catalog.keys.find(row=>row.id===empty.id).apiKey,'');
assert.equal(catalog.keys.find(row=>row.id===created.id).apiKey,'[stored]');
for(const output of [created,updated,catalog]){
  const encoded=JSON.stringify(output);
  for(const secret of [short.apiKey,stored.apiKey,stored.apiKey.slice(0,4),stored.apiKey.slice(-4),'untrusted-replacement'])assert.ok(!encoded.includes(secret));
}
console.log('PASS controlled parity catalog/create/update responses conceal complete and partial keys; stored key and update semantics retained; server authentication/roles not established');
