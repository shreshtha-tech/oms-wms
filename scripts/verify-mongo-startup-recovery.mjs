import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
const mongo=new URL(process.env.MONGODB_URI||'');
assert.equal(mongo.hostname,'127.0.0.1');
const mongoPid=Number(process.env.MONGO_TEST_PROCESS_PID);assert.ok(mongoPid>0,'Use disposable Mongo wrapper');
const configured=new URL(process.env.INVENTORY_DATABASE_URL||'');
assert.ok(['localhost','127.0.0.1','::1'].includes(configured.hostname));
const name=`codexqa_startup_${randomUUID().replaceAll('-','').slice(0,12)}`;
const fixture=new URL(configured);fixture.pathname=`/${name}`;
const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex'),username=`qa_${name}`;
const hash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
const admin=new pg.Client({connectionString:configured.toString(),connectionTimeoutMillis:8000});
const base='http://127.0.0.1:3157';let created=false,server,paused=false,cookie;
async function request(path,options={}){const response=await fetch(base+path,{...options,headers:{cookie,...options.headers},signal:AbortSignal.timeout(25000)});return{status:response.status,body:await response.json(),response};}
async function stop(){if(server&&server.exitCode===null){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await ended;assert.equal(server.exitCode,0,'Graceful shutdown must succeed during database outage');}server=undefined;}
async function start(){server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3157',DMILLS_REQUIRE_PERSISTENCE:'true',DMILLS_ADMIN_USER:username,DMILLS_ADMIN_PASSWORD_HASH:hash,INVENTORY_ALLOWED_TENANT_ID:name,INVENTORY_CREDENTIAL_KEY:randomBytes(32).toString('hex')},stdio:['ignore','ignore','ignore']});
 for(let i=0;i<100;i++){assert.equal(server.exitCode,null,'Server crashed at startup');try{if((await request('/health/live')).status===200)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Liveness startup timeout');}
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 process.env.INVENTORY_DATABASE_URL=fixture.toString();
 const{migrateInventory,inventoryPool}=await import('../inventory/db.js');await migrateInventory();await inventoryPool().end();
 process.kill(mongoPid,'SIGSTOP');paused=true;
 await start();
 const login=await request('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(login.status,200);cookie=login.response.headers.get('set-cookie').split(';',1)[0];
 const first=await request('/api/sku-groups');assert.equal(first.status,503);assert.equal(first.body.error,'DATABASE_UNAVAILABLE');assert.ok(!('rows'in first.body));
 assert.equal((await request('/health/ready')).status,503);assert.equal((await request('/health/live')).status,200);
 assert.equal((await request('/api/inventory-sync/central/summary')).status,200);
 await stop();await start();
 assert.equal((await request('/api/inventory-sync/central/summary')).status,200,'Durable session and PG routes survive restart during Mongo outage');
 assert.equal((await request('/api/sku-groups')).status,503);
 process.kill(mongoPid,'SIGCONT');paused=false;
 let recovered;for(let i=0;i<40;i++){recovered=await request('/api/sku-groups');if(recovered.status===200)break;await new Promise(resolve=>setTimeout(resolve,500));}
 assert.equal(recovered.status,200);assert.deepEqual(recovered.body.rows,[]);
 const concurrent=await Promise.all(Array.from({length:20},()=>request('/api/sku-groups')));assert.ok(concurrent.every(result=>result.status===200));
 assert.equal((await request('/health/ready')).status,200);
 console.log('PASS real Mongo startup/restart outage: liveness, safe 503 without fake rows, PG independence, durable auth across server restart, recovery without restart, concurrent reads and graceful shutdown');
}finally{
 if(paused)process.kill(mongoPid,'SIGCONT');
 await stop();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();
 console.log('Disposable startup PostgreSQL fixture removed.');
}
