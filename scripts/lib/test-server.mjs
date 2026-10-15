import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { testEnvironment } from '../run-ci-tests.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
function assertDisposable(value, protocol) {
  const url = new URL(value);
  assert.equal(url.protocol,protocol);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Test server only uses local disposable stores');
  assert.match(url.pathname,/\/[a-z][a-z0-9_]*_test$/,'Test server requires a disposable _test database');
  return url;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(resolve => child.once('exit',resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'),5000);
  await done;clearTimeout(timer);
}

export async function startTestServer() {
  assert.equal(process.env.NODE_ENV,'test');
  const pgUrl = assertDisposable(process.env.INVENTORY_DATABASE_URL,'postgresql:');
  const mongoUrl = assertDisposable(process.env.MONGODB_URI,'mongodb:');
  assert.match(process.env.MONGODB_DB || '',/^[a-z][a-z0-9_]*_test$/);
  const name = `ci_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}_test`;
  const admin = new pg.Client({ connectionString: pgUrl.href });
  const mongo = new MongoClient(mongoUrl.href, { serverSelectionTimeoutMS: 5000 });
  const user = `ci_${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
  const testPg = new URL(pgUrl);testPg.pathname=`/${name}`;
  const testMongo = new URL(mongoUrl);testMongo.pathname=`/${name}`;
  let created = false, mongoCreated = false, server, closed = false;
  const close = async () => {
    if (closed) return;closed=true;
    await stop(server);
    try {
      if (mongoCreated) await mongo.db(name).dropDatabase();
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally { await mongo.close();await admin.end(); }
  };
  try {
    await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
    await mongo.connect();
    await mongo.db(name).collection('generic_records').insertOne({ module:'location', id:1, code:'CI-WH', name:'Delhi NCR Store', location_code:'CI-WH', location_name:'Delhi NCR Store', status:'Active' });mongoCreated=true;
    const env = { ...testEnvironment(process.env,['postgres','mongo-rs','browser']),NODE_ENV:'test',DMILLS_SKIP_DOTENV:'true',PORT:'0',
      INVENTORY_DATABASE_URL:testPg.href,MONGODB_URI:testMongo.href,MONGODB_DB:name,
      INVENTORY_ALLOWED_TENANT_ID:name,DMILLS_REQUIRE_PERSISTENCE:'true',
      DMILLS_ADMIN_USER:user,DMILLS_ADMIN_PASSWORD_HASH:passwordHash,
      DMILLS_ADMIN_PERMISSIONS_JSON:'[]',DMILLS_OPERATOR_ACCOUNTS_JSON:'[]',
      INVENTORY_CREDENTIAL_KEY:randomBytes(32).toString('hex') };
    const migration = spawn(process.execPath,['scripts/inventory-migrate.mjs'],{cwd:repo,env,stdio:'ignore'});
    const migrationCode = await new Promise((resolve,reject) => { migration.once('exit',resolve);migration.once('error',reject); });
    assert.equal(migrationCode,0,'Test-server migrations failed');
    const preload = fileURLToPath(new URL('./test-server-preload.mjs',import.meta.url));
    server = spawn(process.execPath,['--import',preload,'server.js'],{cwd:repo,env,stdio:['ignore','ignore','ignore','ipc']});
    const port = await new Promise((resolve,reject) => {
      const timer=setTimeout(() => reject(new Error('Test server startup timeout')),30000);
      server.once('error',error => {clearTimeout(timer);reject(error);});
      server.once('exit',() => {clearTimeout(timer);reject(new Error('Test server exited during startup'));});
      server.on('message',message => {if(message.type==='test-server-listening'){clearTimeout(timer);resolve(message.port);}});
    });
    const baseUrl=`http://127.0.0.1:${port}`;
    let ready = false;
    for(let i=0;i<80;i++) {
      const response=await fetch(`${baseUrl}/api/health/ready`,{signal:AbortSignal.timeout(2000)});
      if(response.ok && (await response.json()).ready){ready=true;break;}
      await pause(250);
    }
    assert.ok(ready,'Seeded test app must become ready');
    const response=await fetch(`${baseUrl}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','Origin':baseUrl},body:JSON.stringify({username:user,password}),signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200,'Seeded administrator must authenticate through the real login endpoint');
    const sessionCookie=response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(sessionCookie,'Login must issue a session cookie');
    const session=await fetch(`${baseUrl}/api/auth/session`,{headers:{Cookie:sessionCookie}});
    assert.equal((await session.json()).user.username,user);
    return { baseUrl,sessionCookie,username:user,close };
  } catch(error) { await close();throw error; }
}
