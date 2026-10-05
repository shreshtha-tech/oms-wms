import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { inventoryPool, migrateInventory } from '../inventory/db.js';

const pgUrl=new URL(process.env.INVENTORY_DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','::1'].includes(pgUrl.hostname));
assert.match(pgUrl.pathname,/^\/codexqa_test_wms_recovery_[a-f0-9]{12}$/);
assert.ok(process.env.MONGODB_URI,'This read-only recovery check requires configured MongoDB');
process.env.DMILLS_REQUIRE_PERSISTENCE='false';
process.env.INVENTORY_CREDENTIAL_KEY=randomBytes(32).toString('hex');
const username='wms-recovery-fixture';
const password=randomBytes(24).toString('hex');
const salt=randomBytes(16).toString('hex');
process.env.DMILLS_ADMIN_USER=username;
process.env.DMILLS_ADMIN_PASSWORD_HASH=`${salt}:${(await promisify(scryptCallback)(password,salt,64)).toString('hex')}`;
const db=inventoryPool();
let child;
let exited;
try{
  await migrateInventory();
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test'},stdio:'ignore'});
  exited=new Promise(resolve=>child.once('exit',resolve));
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<120;i++){
    if(child.exitCode!==null)throw new Error('Read-only recovery server exited before ready');
    try{const response=await fetch(`${base}/health/ready`);if(response.ok){const body=await response.json();ready=body.dependencies?.mongodb==='READY'&&body.dependencies?.postgres==='READY';}}catch{}
    if(ready)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(ready,true,'Configured Mongo and disposable PostgreSQL must both reach READY');
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  assert.equal(login.status,200,'Synthetic administrator authenticates against disposable PostgreSQL');
  const cookie=(login.headers.get('set-cookie')||'').split(';',1)[0];
  assert.match(cookie,/^dmills_session=[a-f0-9]{64}$/);
  const headers={cookie,'content-type':'application/json'};
  const metadata=await fetch(`${base}/api/wms-zones`,{headers});
  assert.equal(metadata.status,200,'Zone metadata reads from configured MongoDB after reconnect');
  const meta=await metadata.json();
  assert.ok(Array.isArray(meta.locations)&&Array.isArray(meta.bins)&&Array.isArray(meta.pickers));
  const search=await fetch(`${base}/api/wms-zones`,{method:'POST',headers,body:JSON.stringify({rows:20,page:1,sidx:'',sord:'asc',zoneCode:'',descr:'',picktoLoc:'',kittoLoc:'',qcBin:'-1',status:'-1',locCode:'',zoneType:'',letDownBin:'',REQ_SEARCH_FLAG:true})});
  assert.equal(search.status,200,'Zone list reads from configured MongoDB after reconnect');
  const result=await search.json();
  assert.ok(Array.isArray(result.zoneDTOList)&&Array.isArray(result.gridModel));
  console.log(JSON.stringify({result:'PASS',layer:'local HTTP server; synthetic PostgreSQL auth account; configured MongoDB read-only',readiness:'MongoDB and PostgreSQL READY',session:'login and HttpOnly session issued',zoneMetadataStatus:metadata.status,zoneMetadataCounts:{locations:meta.locations.length,bins:meta.bins.length,pickers:meta.pickers.length},zoneSearchStatus:search.status,zoneRows:result.records}));
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await exited;}
  await db.end();
}
