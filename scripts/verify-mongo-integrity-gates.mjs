import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const suites=['verify-vendor-integrity','verify-customer-integrity','verify-transporter-integrity','verify-mongo-isolated-workflows'];
const results=[];
for(const name of suites){
 const child=spawn(process.execPath,[`scripts/${name}.mjs`],{env:process.env,stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output+=String(chunk));
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await writeFile(`tmp/mongo-reliability/${name}.log`,output);results.push({name,code});console.log(`${code===0?'PASS':'FAIL'} ${name}`);
}
await writeFile('tmp/mongo-reliability/mongo-integrity-results.json',JSON.stringify(results,null,2));
if(results.some(result=>result.code!==0))process.exitCode=1;
