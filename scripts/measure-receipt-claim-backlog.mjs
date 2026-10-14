import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { statfs, writeFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { mongoDomainTransaction, closeDataStore } from '../api/mongo.js';
import { receiptResultClaimSql, mongoReadyClaim, mongoReceiptClaimIndexes } from '../inventory/receipt-claim-query.js';

validateTestStores(process.env);
const disk=await statfs(process.cwd());
if(disk.bavail*disk.bsize<500*1024*1024)throw new Error('Disposable backlog test requires at least 500 MiB free');
const evidenceFile=new URL('../docs/hardening/receipt-claim-backlog-evidence.json',import.meta.url);
const tenant='receipt-backlog-fixture',mongo=new MongoClient(process.env.MONGODB_URI),pg=inventoryPool();
const count=100000,workers=5,claimsPerWorker=200;
const evidence={status:'RUNNING',layer:'OWNED_FRESH_LOOPBACK_MONGO_POSTGRES',runtime:process.version,workload:{pendingPerStore:count,workersPerStore:workers,claimsPerWorker},startedAt:new Date().toISOString()};
await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n');
function summary(samples){
 const sorted=[...samples].sort((a,b)=>a-b);
 const rank=p=>Number(sorted[Math.ceil(p*sorted.length)-1].toFixed(3));
 return {n:sorted.length,p50Ms:rank(.5),p95Ms:rank(.95),p99Ms:rank(.99),maxMs:rank(1)};
}
try {
 await migrateInventory();await mongo.connect();
 const collection=mongo.db(process.env.MONGODB_DB).collection('_domain_outbox');
 for(const definition of mongoReceiptClaimIndexes)await collection.createIndex(definition.keys,definition.options);
 const available=new Date(Date.now()-60000);
 for(let offset=0;offset<count;offset+=1000){
  await collection.insertMany(Array.from({length:1000},(_,i)=>({_id:`backlog-${String(offset+i).padStart(6,'0')}`,tenant_id:tenant,status:'pending',attempts:0,available_at:available,event:{fixture:true}})),{ordered:true});
 }
 await pg.query(`INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at)
  SELECT gen_random_uuid(),$1,'{}'::jsonb,'pending',0,now()-interval '1 minute',now()+g*interval '1 microsecond'
  FROM generate_series(1,$2::int) g`,[tenant,count]);
 const mongoIds=[],pgIds=[],mongoSamples=[],pgSamples=[];
 const started=performance.now();
 await Promise.all(Array.from({length:workers*2},(_,worker)=> (async()=>{
  for(let i=0;i<claimsPerWorker;i++){
   const start=performance.now();
   if(worker<workers){
    const now=new Date(),token=randomUUID();
    const row=await mongoDomainTransaction((db,session)=>{
     const claim=mongoReadyClaim(tenant,now);
     return db.collection('_domain_outbox').findOneAndUpdate(claim.filter,{$set:{status:'processing',claim_token:token,lease_until:new Date(now.getTime()+120000)},$inc:{attempts:1}},{session,sort:claim.sort,returnDocument:'after',includeResultMetadata:false});
    });
    assert.ok(row);mongoIds.push(row._id);mongoSamples.push(performance.now()-start);
   }else{
    const result=await pg.query(receiptResultClaimSql,[tenant,randomUUID()]);
    assert.equal(result.rows.length,1);pgIds.push(result.rows[0].event_id);pgSamples.push(performance.now()-start);
   }
  }
 })()));
 const elapsedMs=Number((performance.now()-started).toFixed(3));
 assert.equal(new Set(mongoIds).size,workers*claimsPerWorker);
 assert.equal(new Set(pgIds).size,workers*claimsPerWorker);
 assert.equal(await collection.countDocuments({tenant_id:tenant,status:'pending'}),count-workers*claimsPerWorker);
 assert.equal(await collection.countDocuments({tenant_id:tenant,status:'processing'}),workers*claimsPerWorker);
 const pgStates=await pg.query("SELECT status,count(*)::int AS n FROM ci_domain_outbox WHERE tenant_id=$1 GROUP BY status",[tenant]);
 assert.deepEqual(Object.fromEntries(pgStates.rows.map(row=>[row.status,row.n])),{pending:count-workers*claimsPerWorker,processing:workers*claimsPerWorker});
 Object.assign(evidence,{status:'PASS',elapsedMs,mongo:summary(mongoSamples),postgres:summary(pgSamples),completedAt:new Date().toISOString(),limitations:['Closed-loop claim-only workload on one disposable host; no business effects, provider calls, hosted deployment, sustained soak or approved launch target.','Two-minute leases remain processing at test end and the owned database is removed.']});
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n');
 console.log('PASS owned receipt claim backlog:',JSON.stringify({mongo:evidence.mongo,postgres:evidence.postgres,elapsedMs}));
}catch(error){
 Object.assign(evidence,{status:'FAIL',errorCategory:error.code||error.name,completedAt:new Date().toISOString()});
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n');
 throw error;
}finally{await mongo.close();await closeDataStore();await pg.end();}
