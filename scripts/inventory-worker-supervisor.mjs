import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let child;
let restartTimer;
let shutdownTimer;
let stopping = false;
let failures = 0;
function supervisorLog(...args){try{console.error(...args);}catch{}}

function start() {
  if (stopping) return;
  const startedAt = Date.now();
  child = spawn(process.execPath, [fileURLToPath(new URL('./inventory-worker.mjs', import.meta.url))], {
    stdio: 'inherit',
    env: process.env,
  });
  let finished=false;
  function recover(code,signal){
    if(finished)return;
    finished=true;
    child = undefined;
    if (stopping) {clearTimeout(shutdownTimer);return;}
    failures = Date.now() - startedAt > 60_000 ? 0 : failures + 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    supervisorLog(`Inventory worker exited (${signal || code}); restarting in ${delay / 1000}s`);
    restartTimer = setTimeout(start, delay);
  }
  child.once('error', () => {supervisorLog('Inventory worker could not start');recover(null,'spawn error');});
  child.once('exit', recover);
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  if (child) {
    const stoppingChild=child;
    stoppingChild.kill('SIGTERM');
    if(child===stoppingChild)shutdownTimer=setTimeout(()=>{
      if(child===stoppingChild){supervisorLog('Inventory worker shutdown deadline reached');stoppingChild.kill('SIGKILL');}
    },30000);
  }else process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
start();
