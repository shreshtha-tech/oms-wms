import assert from 'node:assert/strict';
import { main, mongoZonePickerIndexes } from './mongo-ensure-indexes.mjs';
import { mongoReceiptClaimIndexes } from '../inventory/receipt-claim-query.js';

const env={NODE_ENV:'test',DMILLS_REQUIRE_PERSISTENCE:'true',MONGODB_URI:'mongodb://fixture.invalid/fixture_test',MONGODB_DB:'fixture_test'};
let constructed=0,closed=0;const writes=[],outputs=[];
class Client {
 constructor(){constructed++;}
 async connect(){}
 db(name){assert.equal(name,'fixture_test');return {collection:collection=>({async createIndex(keys,options){writes.push({collection,keys,options});}})};}
 async close(){closed++;}
}
for(const args of [[],['--db','wrong','--yes','--scope','receipt-claims'],['--db','fixture_test','--scope','receipt-claims'],['--db','fixture_test','--yes','--scope','other']]){
 await assert.rejects(()=>main(args,{env,Client,output:line=>outputs.push(line)}));
}
assert.equal(constructed,0);assert.equal(writes.length,0);
await main(['--db','fixture_test','--yes','--scope','receipt-claims'],{env,Client,output:line=>outputs.push(line)});
assert.equal(closed,1);assert.equal(writes.length,2);
assert.deepEqual(writes,mongoReceiptClaimIndexes.map(definition=>({collection:'_domain_outbox',...definition})));
assert.equal(JSON.parse(outputs[0]).scope,'receipt-claims');
await assert.rejects(()=>main(['--db','fixture_test','--scope','zone-pickers'],{env,Client,output:line=>outputs.push(line)}));
assert.equal(constructed,1,'missing confirmation does not construct a client');
writes.length=0;
await main(['--db','fixture_test','--yes','--scope','zone-pickers'],{env,Client,output:line=>outputs.push(line)});
assert.deepEqual(writes,mongoZonePickerIndexes);
assert.equal(JSON.parse(outputs.at(-1)).scope,'zone-pickers');
console.log('PASS Mongo index tool: exact selected DB and yes/scope guards; only measured claim or zone-picker indexes created on injected client.');
