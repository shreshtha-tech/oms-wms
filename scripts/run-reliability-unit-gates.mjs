import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
const names = [
 'verify-mongo-reliability','verify-postgres-reliability','verify-provider-reliability','verify-production-storage-policy',
 'verify-connection-origin','verify-connection-authorization','verify-connection-readiness','verify-connection-runtime-evidence','verify-private-tenant-inputs','verify-snapshot-upload-boundary','verify-tally-xml-boundary','verify-external-app-secret-redaction',
 'verify-vendor-boundaries','verify-customer-boundaries',
 'verify-transporter-boundaries','verify-client-boundaries','verify-customer-group-bypass',
 'verify-generic-protected-modules','verify-partner-master-bypass','verify-tax-category-bypass','verify-tax-group-bypass',
 'verify-tax-code-values',
 'verify-worker-console-boundary','verify-worker-supervisor-boundary','verify-whatsapp-reliability','verify-whatsapp-transport',
 'verify-whatsapp-callback-tenant-boundary','verify-whatsapp-preparation-boundary','verify-wms-api-input-boundary',
 'verify-diagnostic-failure-boundary','verify-credential-diagnostic-order','verify-observation-diagnostic-order',
 'verify-direct-inventory-events-closed','verify-legacy-stock-write-blocks','verify-legacy-fulfillment-write-blocks',
 'verify-admin-key-response-boundary','verify-admin-parity-key-boundary','verify-admin-error-boundary','verify-admin-version-race',
 'verify-connection-secret-view','verify-delimited-export-boundary',
];
await mkdir('tmp/mongo-reliability/unit-gates',{recursive:true});
const results=[];
for(const name of names){
 const child=spawn(process.execPath,[`scripts/${name}.mjs`],{env:{...process.env,MONGODB_URI:'',INVENTORY_DATABASE_URL:'',NODE_ENV:'test',DMILLS_REQUIRE_PERSISTENCE:'false'},stdio:['ignore','pipe','pipe']});
 let output=''; for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);});
 const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 await writeFile(`tmp/mongo-reliability/unit-gates/${name}.log`,output);
 results.push({name,code,passed:code===0});console.log(`${code===0?'PASS':'FAIL'} ${name}`);
}
await writeFile('tmp/mongo-reliability/unit-gates/results.json',JSON.stringify(results,null,2));
if(results.some(result=>!result.passed))process.exitCode=1;
