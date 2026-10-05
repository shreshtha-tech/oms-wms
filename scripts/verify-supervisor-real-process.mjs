import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
for(const checkpoint of ['backoff','restarted','stuck']){
 const child=spawn(process.execPath,['scripts/inventory-worker-supervisor.mjs'],{env:{...process.env,CODEXQA_SUPERVISOR_FIXTURE:'true',CODEXQA_SUPERVISOR_STUCK:checkpoint==='stuck'?'true':'false',NODE_OPTIONS:'--no-warnings --experimental-loader=./scripts/fixture-supervisor-worker-loader.mjs'},stdio:['ignore','pipe','pipe']});
 let starts=0,output='',stopped=false,deadlineReached=false;
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Supervisor fixture checkpoint timeout')),10000);
   child.stdout.on('data',chunk=>{
    output+=chunk.toString();starts=(output.match(/CODEXQA_WORKER_STARTED/g)||[]).length;
    if((checkpoint==='restarted'&&starts>=2)||(checkpoint==='stuck'&&starts===1)){clearTimeout(timer);resolve();}
   });
   child.stderr.on('data',chunk=>{if(chunk.toString().includes('shutdown deadline reached'))deadlineReached=true;if(checkpoint==='backoff'&&chunk.toString().includes('restarting in')){clearTimeout(timer);resolve();}});
   exited.then(()=>{clearTimeout(timer);reject(new Error('Supervisor exited before checkpoint'));},reject);
  });
  child.kill('SIGTERM');const result=await exited;stopped=true;
  assert.equal(result.code,0);assert.equal(result.signal,null);
  assert.equal(starts,checkpoint==='restarted'?2:1);
  if(checkpoint==='stuck')assert.equal(deadlineReached,true,'Ignoring SIGTERM must reach forced-termination deadline');
 }finally{if(!stopped&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited;}}
}
console.log('PASS actual supervisor processes: restart, backoff shutdown, active shutdown and forced termination of SIGTERM-ignoring child. No database/provider imports.');
