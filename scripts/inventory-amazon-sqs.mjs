import '../env.js';
import { pollAmazonSqs } from '../inventory/sqs-worker.js';
for(const name of ['AMAZON_INVENTORY_SQS_URL','INVENTORY_ALLOWED_TENANT_ID','AMAZON_INVENTORY_ACCOUNT_ID'])if(!process.env[name])throw new Error(`${name} required`);
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
let failures=0;
while(!stopped){
 try{
  await pollAmazonSqs({queueUrl:process.env.AMAZON_INVENTORY_SQS_URL,tenantId:process.env.INVENTORY_ALLOWED_TENANT_ID,accountId:process.env.AMAZON_INVENTORY_ACCOUNT_ID,onMessageError:()=>console.error('Amazon SQS message unresolved; retained for source redelivery')});
  failures=0;
 }catch{
  failures=Math.min(failures+1,8);
  console.error('Amazon SQS poll failed; retrying');
  await new Promise(resolve=>setTimeout(resolve,Math.min(60_000,1000*2**failures)*(0.5+0.5*Math.random())));
 }
}
