import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {delimiter,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolveTestBinary,testBinaryPath} from './lib/test-binaries.mjs';
import {createServer} from 'node:net';
const repo=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(repo+'/package.json');
const {MongoClient}=require('mongodb');const pg=require('pg');
const phase=process.argv[2]||'after';
const root=await mkdtemp(join(tmpdir(),'oms-ci-'));
const out=join(repo,'artifacts/pr-01');await mkdir(out,{recursive:true});
const log=join(out,phase+'.txt');await writeFile(log,'');
const path=[dirname(process.execPath),testBinaryPath()].join(delimiter);
const env={PATH:path,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR || tmpdir(),LANG:'C',NODE_ENV:'test',DMILLS_SKIP_DOTENV:'true'};
const processes=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const exit=child=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise((r,j)=>{child.once('exit',r);child.once('error',j)});
const launch=(bin,args)=>{const child=spawn(bin,args,{env,stdio:'ignore'});processes.push(child);return child};
async function port(){const s=createServer();s.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
let admin,mongo;
try{
 const pgPort=await port(),mongoPort=await port();
 if(await exit(launch(resolveTestBinary('initdb'),['-D',join(root,'pg'),'-U','postgres','--auth=trust','--no-locale']))!==0)throw Error('initdb failed');
 launch(resolveTestBinary('postgres'),['-D',join(root,'pg'),'-h','127.0.0.1','-p',String(pgPort),'-k',root]);
 await mkdir(join(root,'mongo'));
 launch(resolveTestBinary('mongod'),['--replSet','rs0','--dbpath',join(root,'mongo'),'--port',String(mongoPort),'--bind_ip','127.0.0.1','--nounixsocket','--logpath',join(root,'mongo.log')]);
 for(let i=0;i<100;i++){const c=new pg.Client({host:'127.0.0.1',port:pgPort,user:'postgres',database:'postgres',connectionTimeoutMillis:200});try{await c.connect();admin=c;break}catch{await c.end();await pause(100)}}
 if(!admin)throw Error('PG readiness');await admin.query('CREATE DATABASE oms_ci_test');
 mongo=new MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`,{serverSelectionTimeoutMS:300});
 for(let i=0;i<100;i++){try{await mongo.connect();await mongo.db('admin').command({ping:1});break}catch{await pause(100)}}
 await mongo.db('admin').command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:`127.0.0.1:${mongoPort}`}]}});
 for(let i=0;i<100;i++){if((await mongo.db('admin').command({hello:1})).isWritablePrimary)break;await pause(100)}
 Object.assign(env,{INVENTORY_DATABASE_URL:`postgresql://127.0.0.1:${pgPort}/oms_ci_test`,PGUSER:'postgres',INVENTORY_DB_SSL:'false',MONGODB_URI:`mongodb://127.0.0.1:${mongoPort}/oms_ci_test?replicaSet=rs0`,MONGODB_DB:'oms_ci_test',DMILLS_REQUIRE_PERSISTENCE:'true',NODE_OPTIONS:`--import=${new URL('./lib/ci-isolation-preload.mjs',import.meta.url).href}`});
 const {scripts}=JSON.parse(await readFile(repo+'/package.json','utf8'));
 const names=process.argv[3]?process.argv.slice(3):Object.keys(scripts).filter(n=>n.startsWith('test:')).sort();
 const results=[];
 for(const name of ['inventory:migrate',...names]){
  const cmd=`npm run ${name}`;const started=Date.now();let output='',timedOut=false;
  const testEnv=phase.startsWith('after')&&name.startsWith('test:') ? (await import(repo+'/scripts/run-ci-tests.mjs')).testEnvironment(env,JSON.parse(await readFile(repo+'/ci-test-manifest.json','utf8')).tests[name].needs):env;
  const child=spawn('npm',['run',name],{cwd:repo,env:testEnv,stdio:['ignore','pipe','pipe'],detached:true});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output+=String(b));
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM')}catch{}},120000);
  const killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},125000);
  const code=await exit(child);clearTimeout(timer);clearTimeout(killTimer);
  const result={name,command:cmd,status:code===0&&!timedOut?'PASS':'FAIL',code,timedOut,durationMs:Date.now()-started,output};results.push(result);
  await appendFile(log,`\n$ ${cmd}\n${output}\n${result.status} (exit ${code}, ${result.durationMs}ms)\n`);
  await writeFile(join(out,phase+'.json'),JSON.stringify({node:process.version,database:'owned PostgreSQL / Mongo replica set; configured stores blocked',completed:results.length,total:names.length+1,results},null,2)+'\n');
  console.log(`${results.length}/${names.length+1} ${name}: ${result.status} (${result.durationMs}ms)`);
 }
}finally{
 await mongo?.close();await admin?.end();
 for(const child of processes.reverse())if(child.exitCode===null){const done=exit(child);child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done;clearTimeout(timer)}
 await rm(root,{recursive:true,force:true});console.log('Owned stores removed');
}
