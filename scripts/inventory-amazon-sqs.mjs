import '../env.js';
import { pollAmazonSqs } from '../inventory/sqs-worker.js';
for(const name of ['AMAZON_INVENTORY_SQS_URL','INVENTORY_ALLOWED_TENANT_ID','AMAZON_INVENTORY_ACCOUNT_ID'])if(!process.env[name])throw new Error(`${name} required`);
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
while(!stopped)await pollAmazonSqs({queueUrl:process.env.AMAZON_INVENTORY_SQS_URL,tenantId:process.env.INVENTORY_ALLOWED_TENANT_ID,accountId:process.env.AMAZON_INVENTORY_ACCOUNT_ID});
