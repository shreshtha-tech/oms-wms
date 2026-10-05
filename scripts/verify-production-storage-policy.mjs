import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const childSource=`
 import assert from 'node:assert/strict';
 import {find,getMode,probeDataStore,waitForDataReady,insert} from './api/mongo.js';
 if(process.env.CODEX_STORAGE_EXPECTED==='persistent'){
  await assert.rejects(waitForDataReady(),/MONGODB_URI is required/);
  await assert.rejects(probeDataStore(),/MONGODB_URI is required/);
  await assert.rejects(find('inventory'),/MONGODB_URI is required/);
  await assert.rejects(insert('inventory',{sku_code:'fixture',quantity:1}),/MONGODB_URI is required/);
  assert.equal(getMode(),'unavailable');
 }else{
  assert.equal(await waitForDataReady(),'memory');
  assert.deepEqual(await find('inventory'),[]);
 }
`;
for(const [label,nodeEnv,flag,expected] of [
 ['production flag omitted','production','','persistent'],
 ['production flag false','production','false','persistent'],
 ['development enforced','development','true','persistent'],
 ['development unconfigured','development','','memory'],
 ['test unconfigured','test','','memory'],
]){
 const result=spawnSync(process.execPath,['--input-type=module','-e',childSource],{
  cwd:process.cwd(),env:{...process.env,NODE_ENV:nodeEnv,DMILLS_REQUIRE_PERSISTENCE:flag,MONGODB_URI:'',CODEX_STORAGE_EXPECTED:expected},encoding:'utf8',timeout:15000,
 });
 assert.equal(result.status,0,`${label}: storage policy regression failed\n${result.stderr}`);
}
for(const flag of ['', 'false']){
 const result=spawnSync(process.execPath,['server.js'],{
  cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',DMILLS_REQUIRE_PERSISTENCE:flag,MONGODB_URI:'',PORT:'0'},encoding:'utf8',timeout:15000,
 });
 assert.ok(result.status!==null&&result.status!==0,'Production server must exit before listening without persistent storage');
 assert.match(result.stderr,/MONGODB_URI is required when persistent storage is enforced/);
 assert.equal(result.stdout.includes('server running'),false);
}
console.log('PASS storage policy: production refuses missing persistence despite omitted/false flag; explicit development enforcement refuses reads/writes; unconfigured development/test remains isolated memory.');
