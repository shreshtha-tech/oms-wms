import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const configured=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(configured.hostname))throw new Error('Session verifier requires local PostgreSQL');
const name=`codexqa_test_sessions_${Date.now().toString(36)}_${randomUUID().slice(0,6)}`;
const admin=new pg.Client({connectionString:configured.toString(),connectionTimeoutMillis:8000});
let created=false;
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 configured.pathname=`/${name}`;
 const child=spawn(process.execPath,['scripts/verify-session-recovery.mjs'],{cwd:process.cwd(),env:{...process.env,INVENTORY_DATABASE_URL:configured.toString()},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw new Error('Isolated session verifier failed');
}finally{
 if(created){await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);console.log('Isolated session PostgreSQL database removed.');}
 await admin.end();
}
