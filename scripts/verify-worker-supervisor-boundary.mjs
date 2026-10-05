import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { format } from 'node:util';
const source=(await readFile(new URL('./inventory-worker-supervisor.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('./inventory-worker-supervisor.mjs',import.meta.url).href));
for(const brokenLogger of [true,false]){
 const processEvents=new Map(),childEvents=new Map(),logs=[],timers=new Map();let spawns=0,killed=0;
 const processDouble={execPath:'fixture-node',env:{},on:(name,fn)=>processEvents.set(name,fn),exit:()=>{}};
 const child={once:(name,fn)=>childEvents.set(name,fn),kill:signal=>{assert.ok(['SIGTERM','SIGKILL'].includes(signal));killed++;}};
 const logger={error(...args){if(brokenLogger)throw new Error('fixture-private-console-secret');logs.push(format(...args));}};
 new Function('process','spawn','fileURLToPath','console','setTimeout','clearTimeout',source)(processDouble,()=>{spawns++;return child;},()=>'/fixture-worker',logger,(fn,delay)=>{const id=timers.size+1;timers.set(id,{fn,delay});return id;},id=>timers.delete(id));
 assert.equal(spawns,1);
 childEvents.get('error')(new Error('fixture-private-spawn-secret'));
 assert.equal(timers.size,1,'Spawn failure must schedule recovery without an exit event');
 childEvents.get('exit')(1,null);
 assert.equal(timers.size,1,'Logging failure must not prevent restart scheduling');
 assert.equal([...timers.values()][0].delay,2000);
 const restart=[...timers.values()][0];timers.clear();restart.fn();assert.equal(spawns,2);
 processEvents.get('SIGTERM')();assert.equal(killed,1);assert.equal(timers.size,1,'Active child shutdown requires a bounded termination deadline');
 const deadline=[...timers.values()][0];assert.equal(deadline.delay,30000);deadline.fn();assert.equal(killed,2);
 childEvents.get('exit')(0,'SIGTERM');assert.equal(timers.size,0,'Stopped supervisor cannot schedule another restart');
 assert.equal(logs.join('\n').includes('fixture-private'),false,'Supervisor must withhold raw spawn errors');
}
for(const signal of ['SIGINT','SIGTERM','SIGHUP']){
 const processEvents=new Map(),children=[],timers=new Map();let clock=0,timerId=0,exits=0;
 const processDouble={execPath:'fixture-node',env:{},on:(name,fn)=>processEvents.set(name,fn),exit:()=>{exits++;}};
 const spawn=()=>{const events=new Map();children.push(events);return {once:(event,fn)=>events.set(event,fn),kill:()=>assert.fail('No child exists during backoff shutdown')};};
 new Function('process','spawn','fileURLToPath','console','setTimeout','clearTimeout','Date',source)(processDouble,spawn,()=>'/fixture-worker',{error:()=>{}},(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},id=>timers.delete(id),{now:()=>clock});
 for(const expected of [2000,4000,8000,16000,30000,30000,30000]){
  clock++;
  const old=children.at(-1);old.get('exit')(1,null);
  assert.equal(timers.size,1);const scheduled=[...timers.values()][0];assert.equal(scheduled.delay,expected);
  timers.clear();clock+=expected;scheduled.fn();
  old.get('error')(new Error('fixture old event'));assert.equal(timers.size,0,'Late old-child event cannot restart or detach current worker');
 }
 clock+=61000;children.at(-1).get('exit')(1,null);
 assert.equal(timers.size,1);const pending=[...timers.values()][0];assert.equal(pending.delay,1000,'Healthy runtime must reset failure backoff');
 const before=children.length;
 processEvents.get(signal)();assert.equal(timers.size,0);assert.equal(exits,1);
 pending.fn();assert.equal(children.length,before,'Even a cancelled timer callback cannot spawn after shutdown');
 processEvents.get(signal)();assert.equal(exits,1,'Shutdown is idempotent');
}
console.log('PASS isolated supervisor: safe logging, spawn recovery, late-event fencing, repeated backoff/cap/reset and all shutdown signals.');
