import { resolveTestBinary } from './lib/test-binaries.mjs';
import {randomInt,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MongoClient} from 'mongodb';
const directory=await mkdtemp(join(tmpdir(),'codexqa-tax-mongo-'));
const uri=`mongodb://127.0.0.1:${randomInt(20000,50000)}`;
const port=new URL(uri).port;
const name=`codexqa_tax_${randomUUID().slice(0,8)}`;
const daemon=spawn(resolveTestBinary('mongod'),['--dbpath',directory,'--port',port,'--bind_ip','127.0.0.1','--nounixsocket','--logpath',join(directory,'mongod.log')],{stdio:'ignore'});
let startError;daemon.on('error',error=>{startError=error;});
const client=new MongoClient(uri,{serverSelectionTimeoutMS:500});
try{
 let ready=false;
 for(let i=0;i<80;i++){
  if(startError||daemon.exitCode!==null)throw new Error('Disposable Mongo failed to start');
  try{await client.connect();await client.db('admin').command({ping:1});ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,150));}
 }
 if(!ready)throw new Error('Disposable Mongo readiness timeout');
 const child=spawn(process.execPath,['scripts/verify-tax-group-standalone.mjs'],{env:{...process.env,MONGODB_URI:uri,MONGODB_DB:name,TAX_MONGO_FIXTURE:'true'},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw new Error('Tax Mongo verifier failed');
}finally{
 await client.close();
 if(daemon.exitCode===null){const exited=new Promise(resolve=>daemon.once('exit',resolve));daemon.kill('SIGTERM');await exited;}
 await rm(directory,{recursive:true,force:true});
 console.log('Disposable tax Mongo process and data directory removed.');
}
