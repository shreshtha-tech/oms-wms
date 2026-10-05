import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
const allowed=new Set(['scripts/verify-return-without-order.mjs','scripts/verify-inventory-publish-order.mjs','scripts/verify-seller-connections.mjs','scripts/verify-sales-programs.mjs','scripts/verify-stock-observation-ordering.mjs','scripts/verify-order-webhook-evidence.mjs','scripts/verify-browser-credential-boundary.mjs']);
const suite=process.argv[2];if(!allowed.has(suite))throw new Error('Unsupported isolated reliability suite');
const configured=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(configured.hostname))throw new Error('Use local PostgreSQL only');
const name=`codexqa_test_reliable_${randomUUID().replaceAll('-','').slice(0,12)}`;
const admin=new pg.Client({connectionString:configured.toString(),connectionTimeoutMillis:8000});let created=false;
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 configured.pathname=`/${name}`;
 const child=spawn(process.execPath,[suite],{env:{...process.env,INVENTORY_DATABASE_URL:configured.toString(),MONGODB_URI:'',MONGODB_DB:'',NODE_ENV:'test',DMILLS_REQUIRE_PERSISTENCE:'false'},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
 if(code!==0)throw new Error('Isolated reliability verifier failed');
}finally{
 if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
 await admin.end();console.log('Disposable reliability PostgreSQL database removed.');
}
