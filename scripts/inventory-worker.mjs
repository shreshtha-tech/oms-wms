import '../env.js';
import { runInventoryTaskBatch, reconcileShopifyStock } from '../inventory/workers.js';
import { inventoryPool } from '../inventory/db.js';
import { observeSellerConnections } from '../inventory/connection-observation.js';
import { runWhatsAppBatch } from '../inventory/whatsapp.js';
import { pollShopifyOrderObservations } from '../inventory/shopify-orders.js';
// Console availability is not authority for worker progress or recovery.
function workerLog(method,...args){try{console[method](...args);}catch{}}
if(!process.env.INVENTORY_DATABASE_URL)throw new Error('INVENTORY_DATABASE_URL required');
if(!process.env.INVENTORY_ALLOWED_TENANT_ID)throw new Error('INVENTORY_ALLOWED_TENANT_ID required');
if(!/^[a-f0-9]{64}$/i.test(process.env.INVENTORY_CREDENTIAL_KEY||''))throw new Error('INVENTORY_CREDENTIAL_KEY must be a 32-byte hex key');
const schema=await inventoryPool().query("SELECT to_regclass('public.ci_outbox') AS outbox");
if(!schema.rows[0].outbox)throw new Error('Central inventory migrations are required before starting the worker');
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
// Keep one worker per inventory tenant, including when a second dev or deploy
// process starts. PostgreSQL releases this session lock if the worker dies.
const lease=await inventoryPool().connect();
lease.on('error',()=>{workerLog('error','Inventory worker lock connection lost');process.exit(1);});
let waiting=false;
while(!stopped){
 const result=await lease.query('SELECT pg_try_advisory_lock(20260925,hashtext($1)) AS acquired',[process.env.INVENTORY_ALLOWED_TENANT_ID]);
 if(result.rows[0].acquired)break;
 if(!waiting){workerLog('log','Another inventory worker owns this tenant; waiting for its lease');waiting=true;}
 await new Promise(resolve=>setTimeout(resolve,15000));
}
let nextReconciliation=Date.now();
let nextOrderObservation=Date.now();
let nextHeartbeat=Date.now();
let heartbeatInFlight=false;
const scheduledJobs=new Set();
const scheduledJobPromises=new Set();
function scheduleJob(name,operation){
  if(stopped||scheduledJobs.has(name))return;
  scheduledJobs.add(name);
  const job=Promise.resolve().then(operation).catch(()=>workerLog('error',`${name} job failed`)).finally(()=>{scheduledJobs.delete(name);scheduledJobPromises.delete(job);});
  scheduledJobPromises.add(job);
}
while(!stopped){
  if(Date.now()>=nextHeartbeat){
    nextHeartbeat=Date.now()+30_000;
    if(!heartbeatInFlight){
      heartbeatInFlight=true;
      // Observability may occupy at most one query, never gate task execution.
      Promise.resolve().then(()=>inventoryPool().query("INSERT INTO ci_service_heartbeat(tenant_id,service,last_seen_at) VALUES($1,'inventory-worker',now()) ON CONFLICT(tenant_id,service) DO UPDATE SET last_seen_at=now()",[process.env.INVENTORY_ALLOWED_TENANT_ID]))
        .catch(()=>workerLog('error','Inventory worker heartbeat failed'))
        .finally(()=>{heartbeatInFlight=false;});
    }
  }
  if(Date.now()>=nextOrderObservation){
    nextOrderObservation=Date.now()+60_000;
    scheduleJob('Shopify order observation',async()=>{
      const result=await pollShopifyOrderObservations(process.env.INVENTORY_ALLOWED_TENANT_ID);
      if(result.accounts||result.errors.length)workerLog('log',JSON.stringify({kind:'shopify_order_observation',...result}));
    });
  }
  if(Date.now()>=nextReconciliation){
    nextReconciliation=Date.now()+15*60*1000;
    scheduleJob('Shopify reconciliation',async()=>workerLog('log',JSON.stringify({kind:'shopify_reconciliation',...await reconcileShopifyStock(process.env.INVENTORY_ALLOWED_TENANT_ID),at:new Date().toISOString()})));
    scheduleJob('Seller observation',async()=>workerLog('log',JSON.stringify({kind:'seller_observation',...await observeSellerConnections(process.env.INVENTORY_ALLOWED_TENANT_ID),at:new Date().toISOString()})));
  }
  // A slow notification provider must not gate authoritative inventory work.
  // The scheduled-job guard keeps delivery single-flight for this tenant.
  scheduleJob('WhatsApp delivery',async()=>{await runWhatsAppBatch();});
  try{const count=await runInventoryTaskBatch();if(!count)await new Promise(r=>setTimeout(r,1000));}
  catch{workerLog('error','Inventory worker failed');await new Promise(r=>setTimeout(r,5000));}
}
// Preserve single-worker ownership while already-started jobs finish. The
// supervisor supplies the bounded termination path for a permanently stuck job.
await Promise.allSettled([...scheduledJobPromises]);
lease.release(true);
await inventoryPool().end();
