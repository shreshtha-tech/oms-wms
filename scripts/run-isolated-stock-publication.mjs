import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import pg from 'pg';

const root=await mkdtemp(join(tmpdir(),'agon-stock-publication-'));
const port=randomInt(35001,50000);
const database=`stock_publication_${Date.now().toString(36)}_test`;
const nativeEnv={PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'C',TMPDIR:root};
const children=[];
function launch(binary,args,env=nativeEnv,stdio='ignore') {
 const child=spawn(binary,args,{env,stdio});child.on('error',error=>{child.launchError=error;});children.push(child);return child;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exited=child=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
let admin;
try {
 const init=launch('/opt/homebrew/bin/initdb',['-D',join(root,'pg'),'-U','postgres','--auth=trust','--no-locale']);
 if(await exited(init)!==0)throw new Error('Disposable PostgreSQL initialization failed');
 const postgres=launch('/opt/homebrew/bin/postgres',['-D',join(root,'pg'),'-h','127.0.0.1','-p',String(port),'-k',root]);
 for(let attempt=0;attempt<100;attempt++){
  if(postgres.launchError||postgres.exitCode!==null)throw new Error('Disposable PostgreSQL process failed');
  admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:300});
  try{await admin.connect();break;}catch{await admin.end().catch(()=>{});admin=null;await pause(100);}
 }
 if(!admin)throw new Error('Disposable PostgreSQL startup timed out');
 await admin.query(`CREATE DATABASE "${database}"`);
 const env={...nativeEnv,NODE_ENV:'test',INVENTORY_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/${database}`,INVENTORY_ALLOWED_TENANT_ID:'publication-fixture'};
 const verifier=launch(process.execPath,['scripts/verify-stock-publication-uncertainty.mjs'],env,'inherit');
 if(await exited(verifier)!==0)throw new Error('Stock publication uncertainty fixture failed');
 const ordering=launch(process.execPath,['scripts/verify-inventory-publish-order.mjs'],env,'inherit');
 if(await exited(ordering)!==0)throw new Error('Stock publication ordering fixture failed');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 await admin?.end().catch(()=>{});
 for(const child of children.reverse())if(child.exitCode===null&&child.signalCode===null&&!child.launchError){
  const done=exited(child);child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done.catch(()=>{});clearTimeout(timer);
 }
 await rm(root,{recursive:true,force:true});
 console.log('Owned disposable PostgreSQL removed.');
}
