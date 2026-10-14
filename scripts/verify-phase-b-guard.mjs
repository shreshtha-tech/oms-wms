import assert from 'node:assert/strict';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
const base={NODE_ENV:'test',MONGODB_DB:'isolation_test',MONGODB_URI:'mongodb://127.0.0.1:29999/isolation_test?replicaSet=test',INVENTORY_DATABASE_URL:'postgresql://127.0.0.1:39999/isolation_test'};
assert.equal(validateTestStores(base),true);
for(const mutation of [
 {MONGODB_URI:'mongodb+srv://cluster.mongodb.net/isolation_test'},
 {MONGODB_URI:'mongodb://cluster.mongodb.net:29999/isolation_test'},
 {MONGODB_URI:'mongodb://127.0.0.1:29999/wrong_test'},
 {MONGODB_URI:'mongodb://127.0.0.1:29999/isolation_test?tls=false'},
 {INVENTORY_DATABASE_URL:'postgresql://host:39999/isolation_test'},
 {INVENTORY_DATABASE_URL:'postgresql://127.0.0.1:39999/prod'},
 {PGHOST:'cluster.mongodb.net'},
 {MONGODB_DB:'not_test'}
])assert.throws(()=>validateTestStores({...base,...mutation}));
console.log('PASS: isolated guard rejects non-loopback, SRV, mismatched DB, override and non-test targets.');
