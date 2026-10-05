import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
// Explicit allowlist: these verifiers use their own in-memory fixtures and never
// need configured tenant databases, a logged-in browser, or a live provider.
const suites = ['verify-amazon-mfn-api','verify-ajio-api','verify-mp-inventory-log',
 'verify-transhipment','verify-transhipment-old','verify-returns-integrity',
 'verify-dispatch-checkpoint','verify-ars-integrity','verify-back-order-integrity',
 'verify-manage-manifests','verify-sort-to-box','verify-download-pdf','verify-download-workbook',
 'verify-common-import','verify-order-refund','verify-order-allocation','verify-delivery-shipping',
 'verify-bulk-order-update','verify-manage-picklists','verify-manage-picking','verify-delivery-split',
 'verify-shipment-handover','verify-order-acknowledgement','verify-consolidate-ewb',
 'verify-inventory-move','verify-order-maintenance','verify-inbound-realtime-integrity'];
await mkdir('tmp/mongo-reliability/extended-gates',{recursive:true});
const results=[];
for (const name of suites) {
 const child=spawn(process.execPath,[`scripts/${name}.mjs`],{env:{...process.env,MONGODB_URI:'',INVENTORY_DATABASE_URL:'',INVENTORY_ALLOWED_TENANT_ID:'',NODE_ENV:'test',DMILLS_REQUIRE_PERSISTENCE:'false'},stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output+=String(chunk));
 const deadline=setTimeout(()=>child.kill('SIGTERM'),45000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});clearTimeout(deadline);
 await writeFile(`tmp/mongo-reliability/extended-gates/${name}.log`,output);
 results.push({name,code,passed:code===0});console.log(`${code===0?'PASS':'FAIL'} ${name}`);
}
await writeFile('tmp/mongo-reliability/extended-gates/results.json',JSON.stringify(results,null,2)+'\n');
if(results.some(row=>!row.passed))process.exitCode=1;
