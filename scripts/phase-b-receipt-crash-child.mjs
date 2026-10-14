import { MongoClient } from 'mongodb';
import { consumeReceiptCommand } from '../inventory/receipt-bridge.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
validateTestStores(process.env);
const mongo=new MongoClient(process.env.MONGODB_URI);
try{
 await mongo.connect();
 const command=await mongo.db(process.env.MONGODB_DB).collection('_domain_outbox').findOne({_id:JSON.stringify([process.env.INVENTORY_ALLOWED_TENANT_ID,process.argv[2]])});
 if(!command)throw new Error('Synthetic receipt command absent');
 await consumeReceiptCommand(command.event);
 process.send?.('postgres_committed');
 // The parent sees the signal only after PostgreSQL has committed. Simulate a
 // lost acknowledgement before Mongo projection or command acknowledgement.
 process.kill(process.pid,'SIGKILL');
}finally{await mongo.close();}
