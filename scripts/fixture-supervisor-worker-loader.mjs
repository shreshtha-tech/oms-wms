export async function load(url,context,nextLoad){
 if(url===new URL('./inventory-worker.mjs',import.meta.url).href&&process.env.CODEXQA_SUPERVISOR_FIXTURE==='true'){
  if(process.env.CODEXQA_SUPERVISOR_STUCK==='true')return {format:'module',shortCircuit:true,source:"process.on('SIGTERM',()=>{});console.log('CODEXQA_WORKER_STARTED');setInterval(()=>{},1000);"};
  return {format:'module',shortCircuit:true,source:"console.log('CODEXQA_WORKER_STARTED');process.on('SIGTERM',()=>process.exit(0));setTimeout(()=>process.exit(1),100);"};
 }
 return nextLoad(url,context);
}
