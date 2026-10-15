import { resolveTestBinary, testBinaryPath } from './lib/test-binaries.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import pg from 'pg';

const root = await mkdtemp(join(tmpdir(),'agon-opening-stock-'));
const port = randomInt(35001,50000);
const database = `opening_${Date.now().toString(36)}_test`;
const nativeEnv = { PATH: testBinaryPath(), DMILLS_SKIP_DOTENV: 'true', LANG:'C', TMPDIR:root };
const children = [];
function launch(binary,args,env=nativeEnv,stdio='ignore') {
  const child=spawn(binary,args,{env,stdio:stdio==='ignore'?['ignore','ignore','pipe']:stdio});
  child.startupStderr=''; if(child.stderr)child.stderr.on('data',chunk=>{child.startupStderr=(child.startupStderr+String(chunk)).slice(-2000)});
  child.on('error',error=>{child.launchError=error;});
  children.push(child);return child;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exited=child=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
let admin;
try {
  const init=launch(resolveTestBinary('initdb'),['-D',join(root,'pg'),'-U','postgres','--auth=trust','--no-locale']);
  if (await exited(init)!==0) throw new Error('Disposable PostgreSQL initialization failed');
  const postgres=launch(resolveTestBinary('postgres'),['-D',join(root,'pg'),'-h','127.0.0.1','-p',String(port),'-k',root]);
  for(let attempt=0;attempt<100;attempt++) {
    if(postgres.launchError || postgres.exitCode!==null) throw new Error(`Disposable PostgreSQL process failed: exit=${postgres.exitCode}; stderr=${postgres.startupStderr || '(empty)'}`);
    admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:300});
    try { await admin.connect(); break; } catch { await admin.end().catch(()=>{}); admin=null; await pause(100); }
  }
  if(!admin) throw new Error('Disposable PostgreSQL startup timed out');
  await admin.query(`CREATE DATABASE "${database}"`);
  const env={...nativeEnv,NODE_ENV:'test',INVENTORY_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/${database}`,INVENTORY_ALLOWED_TENANT_ID:'opening-stock-fixture'};
  const verifier=launch(process.execPath,['scripts/verify-opening-stock-migration.mjs'],env,'inherit');
  if(await exited(verifier)!==0) throw new Error('Opening-stock migration fixture failed');
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  await admin?.end().catch(()=>{});
  for(const child of children.reverse()) if(child.exitCode===null && child.signalCode===null && !child.launchError) {
    const done=exited(child); child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    await done.catch(()=>{});clearTimeout(timer);
  }
  await rm(root,{recursive:true,force:true});
  console.log('Owned disposable PostgreSQL removed.');
}
