import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
const suite=process.argv[2]||'scripts/verify-order-alert-routing.mjs';
if(!['scripts/verify-order-alert-routing.mjs','scripts/verify-central-inventory-api.mjs'].includes(suite))throw Error('Unsupported isolated Phase 2 suite');
const base=process.env.INVENTORY_DATABASE_URL;
if(!base)throw Error('INVENTORY_DATABASE_URL required');
const url=new URL(base);if(!['localhost','127.0.0.1','::1'].includes(url.hostname))throw Error('Use local PostgreSQL for isolated suites');
const name=`codexqa_test_whatsapp_${randomUUID().replaceAll('-','').slice(0,16)}`;
const client=new pg.Client({connectionString:base,connectionTimeoutMillis:8000});let created=false;
try{
 await client.connect();await client.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;
 const child=spawn(process.execPath,[suite],{cwd:process.cwd(),env:{...process.env,INVENTORY_DATABASE_URL:url.toString()},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw Error('Isolated verifier failed');
}finally{try{if(created){await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);console.log('Isolated Phase 2 PostgreSQL database removed.');}}finally{await client.end();}}
