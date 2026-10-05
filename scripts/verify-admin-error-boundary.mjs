import assert from 'node:assert/strict';
process.env.MONGODB_URI='';
process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const {default:admin}=await import('../api/admin.js');
const {default:parity}=await import('../api/admin-parity.js');
const marker='fixture-sensitive-error-marker';
const failure=new Error(marker);
failure.name=marker;failure.code=marker;
const poisoned={toString(){throw failure;}};
const logs=[];
const original=console.error;
console.error=(...args)=>logs.push(args);
try{
  for(const [handler,req] of [
    [admin,{method:'GET',query:{type:poisoned},headers:{}}],
    [parity,{method:'POST',query:{},body:{action:'api-save',allowedIps:poisoned},headers:{}}],
  ]){
    const res={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(body){this.body=body;return this;},end(){}};
    await handler(req,res);
    assert.equal(res.statusCode,500);
    assert.deepEqual(res.body,{error:'Unexpected Admin API error'});
    assert.ok(!JSON.stringify(res.body).includes(marker));
  }
  assert.equal(logs.length,2);
  assert.ok(!JSON.stringify(logs).includes(marker));
}finally{console.error=original;}
console.log('PASS controlled admin and parity unexpected-error responses/logs exclude exception message/name/code; no configured dependency or full telemetry proof');
