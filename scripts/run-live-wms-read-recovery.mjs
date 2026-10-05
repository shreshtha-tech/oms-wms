import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
const configured=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(configured.hostname))throw new Error('Only disposable local PostgreSQL is permitted');
if(!process.env.MONGODB_URI)throw new Error('Configured MongoDB is required');
const name=`codexqa_test_wms_recovery_${randomUUID().replaceAll('-','').slice(0,12)}`;
const admin=new pg.Client({connectionString:configured.toString(),connectionTimeoutMillis:8000});
let created=false;
try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  configured.pathname=`/${name}`;
  const child=spawn(process.execPath,['scripts/verify-live-wms-read-recovery.mjs'],{env:{...process.env,INVENTORY_DATABASE_URL:configured.toString()},stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
  if(code!==0)throw new Error('Read-only WMS recovery verification failed');
}finally{
  if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  console.log('Disposable WMS recovery PostgreSQL database removed.');
}
