import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const baseUrl=process.env.INVENTORY_DATABASE_URL;
if(!baseUrl)throw new Error('INVENTORY_DATABASE_URL is required.');
const configured=new URL(baseUrl);
if(!['localhost','127.0.0.1','::1'].includes(configured.hostname))throw new Error('The isolated Central Inventory test requires a local PostgreSQL server.');

const databaseName=`codexqa_test_central_${Date.now().toString(36)}_${randomUUID().slice(0,6)}`;
if(databaseName.length>60)throw new Error('Generated test database name is too long.');
const admin=new pg.Client({connectionString:baseUrl,connectionTimeoutMillis:8000});
let databaseCreated=false,failure=null;
try{
 await admin.connect();
 await admin.query(`CREATE DATABASE "${databaseName}"`);
 databaseCreated=true;
 const testUrl=new URL(baseUrl);testUrl.pathname=`/${databaseName}`;
 const child=spawn(process.execPath,['scripts/verify-central-inventory.mjs'],{cwd:process.cwd(),env:{...process.env,INVENTORY_DATABASE_URL:testUrl.toString()},stdio:'inherit'});
 const {code,signal}=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exitCode,exitSignal)=>resolve({code:exitCode,signal:exitSignal}));});
 if(code!==0)failure=new Error(`Central Inventory verifier exited with ${code??signal}.`);
}catch(error){failure=error;}
finally{
 if(databaseCreated){try{await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);process.stdout.write('Isolated Central Inventory PostgreSQL database removed.\n');}catch(error){failure||=error;process.stderr.write('Could not remove the isolated Central Inventory PostgreSQL database.\n');}}
 await admin.end().catch(()=>{});
}
if(failure)throw failure;
