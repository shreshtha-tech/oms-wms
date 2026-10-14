import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
import { mongoReadyClaim, mongoExpiredClaim, mongoReceiptClaimIndexes } from '../inventory/receipt-claim-query.js';

validateTestStores(process.env);
const evidenceFile=new URL('../docs/hardening/receipt-claim-mongo-plan.json',import.meta.url);
const client=new MongoClient(process.env.MONGODB_URI);
const tenant='receipt-plan-fixture',now=new Date();
function planStats(plan) {
 const names=new Set();
 function walk(value) {
  if(!value||typeof value!=='object')return;
  if(value.indexName)names.add(value.indexName);
  for(const child of Object.values(value))if(typeof child==='object')walk(child);
 }
 walk(plan.queryPlanner?.winningPlan);
 return {documentsExamined:plan.executionStats.totalDocsExamined,keysExamined:plan.executionStats.totalKeysExamined,executionMs:plan.executionStats.executionTimeMillis,indexes:[...names].sort()};
}
try {
 await client.connect();
 const coll=client.db(process.env.MONGODB_DB).collection('receipt_claim_plan_fixture');
 for(let offset=0;offset<20000;offset+=500){
  await coll.insertMany(Array.from({length:500},(_,i)=>({_id:`done-${String(offset+i).padStart(5,'0')}`,tenant_id:tenant,status:'done',attempts:1,available_at:new Date(0)})));
 }
 await coll.insertMany(Array.from({length:1000},(_,i)=>({_id:`ready-${String(i).padStart(5,'0')}`,tenant_id:tenant,status:'pending',attempts:0,available_at:new Date(now.getTime()-100000+i)})));
 await coll.insertOne({_id:'expired-last',tenant_id:tenant,status:'processing',attempts:1,available_at:new Date(0),lease_until:new Date(0)});
 const ready=mongoReadyClaim(tenant,now),expired=mongoExpiredClaim(tenant,now);
 async function measure(claim){return planStats(await coll.find(claim.filter).sort(claim.sort).limit(1).explain('executionStats'));}
 const beforeReady=await measure(ready),beforeExpired=await measure(expired);
 for(const definition of mongoReceiptClaimIndexes)await coll.createIndex(definition.keys,definition.options);
 const afterReady=await measure(ready),afterExpired=await measure(expired);
 assert.equal((await coll.find(ready.filter).sort(ready.sort).limit(1).next())._id,'ready-00000');
 assert.equal((await coll.find(expired.filter).sort(expired.sort).limit(1).next())._id,'expired-last');
 assert.equal((await coll.countDocuments({status:'done'})),20000);
 assert.ok(beforeReady.documentsExamined>=20000&&beforeExpired.documentsExamined>=20000);
 assert.ok(afterReady.documentsExamined<=2&&afterExpired.documentsExamined<=2);
 assert.ok(afterReady.indexes.includes(mongoReceiptClaimIndexes[0].options.name));
 assert.ok(afterExpired.indexes.includes(mongoReceiptClaimIndexes[1].options.name));
 const results={beforeReady,beforeExpired,afterReady,afterExpired};
 await writeFile(evidenceFile,JSON.stringify({status:'PASS',layer:'OWNED_FRESH_LOOPBACK_MONGO',runtime:process.version,rows:21001,...results,limitation:'Find cursor plan uses exact predicate/sort but is not the findOneAndUpdate execution plan or hosted capacity.'},null,2)+'\n');
 console.log('PASS owned Mongo receipt claim plan:',JSON.stringify(results));
}finally{await client.close();}
