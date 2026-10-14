import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, statfs, readFile, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt, createHash } from 'node:crypto';
import { MongoClient, BSON } from 'mongodb';
import { readMongoRows, readMongoOne } from '../api/mongo-read.js';
import { updateMongoDocuments, updateMongoQuery } from '../api/mongo-mutation.js';

const disk = await statfs(tmpdir());
if (disk.bavail * disk.bsize < 500 * 1024 * 1024) throw new Error('NOT RUN: disposable Mongo requires at least 500 MiB free.');
const directory = await mkdtemp(join(tmpdir(), 'mongo-boundaries-owned-'));
const port = randomInt(20000, 50000);
const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', TMPDIR: tmpdir() };
const daemonArgs = ['--replSet', 'owned_boundary', '--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25', '--logpath', join(directory, 'mongod.log')];
let daemon = spawn('/opt/homebrew/bin/mongod', daemonArgs, { env, stdio: 'ignore' });
async function stopOwnedDaemon(signal = 'SIGTERM') {
  if (!daemon.pid || daemon.exitCode !== null || daemon.signalCode !== null) return;
  const exited = new Promise(resolve => daemon.once('exit', resolve));
  daemon.kill(signal);
  const timer = setTimeout(() => daemon.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}
let startError;
daemon.on('error', error => { startError = error; });
const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500, timeoutMS: 15000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (startError || daemon.exitCode !== null) throw new Error('Owned Mongo failed to start; inspect execution permissions and available disk.');
    try { await client.connect(); await client.db('admin').command({ ping: 1 }); ready = true; break; } catch { await pause(150); }
  }
  assert.ok(ready, 'owned Mongo starts');
  await client.db('admin').command({ replSetInitiate: { _id: 'owned_boundary', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  ready = false;
  for (let i = 0; i < 100; i++) {
    if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) { ready = true; break; }
    await pause(100);
  }
  assert.ok(ready, 'owned replica elects primary');
  const collection = client.db('mongo_boundaries_test').collection('records');
  await collection.insertMany(Array.from({ length: 10001 }, (_, i) => ({ id: i + 1, value: 'business value', state: 'before' })));
  const beforeIndex = await collection.find({ id: 10001 }).explain('executionStats');
  await collection.createIndex({ id: 1 }, { unique: true, name: 'owned_numeric_id_unique' });
  const afterIndex = await collection.find({ id: 10001 }).explain('executionStats');
  const latestId = await collection.find({}, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).explain('executionStats');
  assert.equal(beforeIndex.executionStats.nReturned, 1);
  assert.equal(beforeIndex.executionStats.totalDocsExamined, 10001);
  assert.equal(afterIndex.executionStats.nReturned, 1);
  assert.equal(afterIndex.executionStats.totalDocsExamined, 1);
  assert.equal(latestId.executionStats.nReturned, 1);
  assert.ok(latestId.executionStats.totalDocsExamined <= 1);
  await assert.rejects(collection.insertOne({ id: 10001 }), { code: 11000 });
  console.log(JSON.stringify({ scope: 'OWNED_MONGO_FIXTURE_EXPLAIN', rows: 10001, beforeIndex: { docs: beforeIndex.executionStats.totalDocsExamined, keys: beforeIndex.executionStats.totalKeysExamined }, afterIndex: { docs: afterIndex.executionStats.totalDocsExamined, keys: afterIndex.executionStats.totalKeysExamined }, latestId: { docs: latestId.executionStats.totalDocsExamined, keys: latestId.executionStats.totalKeysExamined }, duplicateIdentityRejected: true }));
  assert.equal((await readMongoRows(collection, { id: { $lte: 10000 } })).length, 10000);
  await assert.rejects(readMongoRows(collection, {}), { code: 'DATABASE_RESULT_LIMIT' });
  assert.equal((await readMongoOne(collection, { id: 1 })).value, 'business value');
  const single = await updateMongoDocuments(collection, [1], { state: 'after' }, client);
  assert.equal(single[0].value, 'business value');
  assert.equal(single[0].state, 'after');
  assert.equal((await updateMongoDocuments(collection, [2, 3], { state: 'committed' }, client)).length, 2);
  assert.equal((await collection.findOne({ id: 2 })).state, 'committed');
  // The write itself is within the field budget; the aggregate result exceeds
  // the read budget. Both the update and payload must roll back in real Mongo.
  const ids = Array.from({ length: 12 }, (_, i) => i + 4);
  await assert.rejects(updateMongoDocuments(collection, ids, { state: 'must rollback', payload: 'x'.repeat(800000) }, client), { code: 'DATABASE_RESULT_LIMIT' });
  assert.equal(await collection.countDocuments({ id: { $in: ids }, state: 'before', payload: { $exists: false } }), 12);
  await assert.rejects(updateMongoQuery(collection, {}, { query_marker: true }, client), { code: 'DATABASE_MUTATION_LIMIT' });
  assert.equal(await collection.countDocuments({ query_marker: true }), 0, 'Oversized query update rolls back all matches');
  await updateMongoQuery(collection, { id: { $lte: 1000 } }, { query_marker: true }, client);
  assert.equal(await collection.countDocuments({ query_marker: true }), 1000, 'Exact query batch commits completely');
  // Exercise the specialized application helpers with a real business `value`
  // field. Older metadata unwrapping could mistake that field for the document.
  const keys = ['MONGODB_URI', 'MONGODB_DB', 'NODE_ENV', 'DMILLS_REQUIRE_PERSISTENCE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.MONGODB_URI = `mongodb://127.0.0.1:${port}/mongo_boundaries_test?directConnection=true`;
    process.env.MONGODB_DB = 'mongo_boundaries_test';
    process.env.NODE_ENV = 'test';
    process.env.DMILLS_REQUIRE_PERSISTENCE = 'true';
    const mongo = await import('../api/mongo.js');
    try {
      const vendor = await mongo.insert('vendors', { vendor_code: 'OWNED', audit: [], value: 'vendor business value' });
      const changed = await mongo.updateVendorWithAudit(vendor.id, { name: 'Updated' }, { action: 'fixture' });
      assert.equal(changed.value, 'vendor business value');
      assert.equal(changed.audit.length, 1);
      const record = await mongo.insert('generic_records', { revision: 0, value: 'record business value' });
      await assert.rejects(mongo.insert('generic_records', { id: record.id, name: 'Duplicate identity' }), { code: 'DATABASE_MUTATION_INVALID' });
      const allocated = await Promise.all(Array.from({ length: 20 }, (_, index) => mongo.insert('generic_records', { module: 'allocation-fixture', index })));
      assert.equal(new Set(allocated.map(row => row.id)).size, 20);
      assert.equal((await mongo.find('generic_records', { id: record.id })).length, 1);
      await assert.rejects(mongo.updateIfRevision('generic_records', record.id, 0, { id: record.id + 1 }), { code: 'DATABASE_MUTATION_INVALID' });
      assert.equal((await mongo.findOne('generic_records', { id: record.id })).revision, 0);
      assert.equal((await mongo.updateIfRevision('generic_records', record.id, 0, { name: 'Updated' })).value, 'record business value');
      assert.equal(await mongo.updateIfRevision('generic_records', record.id, 0, { name: 'Stale' }), null);
      const zone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'OWNEDZONE', linked_pickers: [] });
      const linked = await Promise.all(['PICKER-A', 'PICKER-B'].map(picker => mongo.updateWmsZonePickers(zone.id, [picker], 'link-pickers', 'owned-test')));
      assert.equal(linked.length, 2);
      assert.deepEqual(new Set((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers), new Set(['PICKER-A', 'PICKER-B']));
      await mongo.updateWmsZonePickers(zone.id, ['PICKER-A'], 'unlink-pickers', 'owned-test');
      assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, ['PICKER-B']);
      assert.equal(await mongo.updateWmsZonePickers(record.id, ['PICKER-A'], 'link-pickers', 'owned-test'), null, 'foreign module cannot be changed');
      const legacyZone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'LEGACYZONE', linked_pickers: 'PICKER-A' });
      assert.equal(await mongo.updateWmsZonePickers(legacyZone.id, ['PICKER-B'], 'link-pickers', 'owned-test'), null, 'legacy string requires migration');
      assert.equal((await mongo.findOne('generic_records', { id: legacyZone.id })).linked_pickers, 'PICKER-A');
      const fullZone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'FULLZONE', linked_pickers: Array.from({ length: 1000 }, (_, i) => `P${i}`) });
      assert.equal(await mongo.updateWmsZonePickers(fullZone.id, ['PICKER-OVER'], 'link-pickers', 'owned-test'), null, 'capacity fence prevents array growth');
      assert.equal((await mongo.findOne('generic_records', { id: fullZone.id })).linked_pickers.length, 1000);
      const duplicateFullZone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'DUPFULLZONE', linked_pickers: Array(1000).fill('OLD') });
      assert.equal(await mongo.updateWmsZonePickers(duplicateFullZone.id, ['PICKER-NEW'], 'link-pickers', 'owned-test'), null, 'capacity counts stored array entries, including historical duplicates');
      const secondZone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'SECONDZONE', linked_pickers: [] });
      assert.deepEqual(await mongo.bulkLinkWmsZonePickers([
        { id: zone.id, zone: 'OWNEDZONE', picker: 'PICKER-C' },
        { id: secondZone.id, zone: 'SECONDZONE', picker: 'PICKER-D' },
      ], 'owned-test'), { zones: 2, links: 2 });
      assert.ok((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers.includes('PICKER-C'));
      assert.ok((await mongo.findOne('generic_records', { id: secondZone.id })).linked_pickers.includes('PICKER-D'));
      const rejectZone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'REJECTZONE', linked_pickers: [] });
      await client.db('mongo_boundaries_test').command({ collMod: 'generic_records', validator: { $nor: [{ code: 'REJECTZONE', linked_pickers: 'PICKER-X' }] }, validationAction: 'error' });
      try {
        await assert.rejects(mongo.bulkLinkWmsZonePickers([
          { id: zone.id, zone: 'OWNEDZONE', picker: 'PICKER-ROLLBACK' },
          { id: rejectZone.id, zone: 'REJECTZONE', picker: 'PICKER-X' },
        ], 'owned-test'));
        assert.ok(!(await mongo.findOne('generic_records', { id: zone.id })).linked_pickers.includes('PICKER-ROLLBACK'));
        assert.deepEqual((await mongo.findOne('generic_records', { id: rejectZone.id })).linked_pickers, []);
      } finally {
        await client.db('mongo_boundaries_test').command({ collMod: 'generic_records', validator: {} });
      }
      console.log('PASS: concurrent zone picker additions retain both values; unlink, module, capacity and legacy-string guards; forced second-zone write failure rolls back the first.');
      const defaults = await Promise.all(['A', 'B'].map(code => mongo.saveValidationMaster(null, { module: 'receipt-validation', code, receiving_validation_code: code, isDefault: true })));
      assert.equal((await mongo.find('generic_records', { module: 'receipt-validation', isDefault: true })).length, 1);
      const duplicates = await Promise.allSettled([1, 2].map(() => mongo.saveValidationMaster(null, { module: 'receipt-validation', code: 'C', receiving_validation_code: 'C', isDefault: false })));
      assert.equal(duplicates.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(duplicates.find(result => result.status === 'rejected').reason.statusCode, 409);
      await assert.rejects(mongo.saveValidationMaster(defaults[0].id, { module: 'receipt-validation', code: 'C', receiving_validation_code: 'C', isDefault: true }), { statusCode: 409 });
      assert.equal((await mongo.find('generic_records', { module: 'receipt-validation', isDefault: true })).length, 1);
      console.log('PASS: concurrent default saves retain one default; concurrent duplicate codes reject; failed replacement preserves default.');
      console.log('PASS: real application vendor audit and revision helpers preserve business value; stale revision rejects.');
      const generic = client.db('mongo_boundaries_test').collection('generic_records');
      const ownedPicker = await mongo.insert('generic_records', { module: 'user-enquiry', code: 'OWNED-PICKER', name: 'Picker fixture' });
      await generic.insertMany(Array.from({ length: 10001 }, (_, i) => ({ id: -(i + 1), module: 'zone-plan-fixture', code: `PLAN${i}` })));
      const zoneQuery = { id: { $in: [zone.id, secondZone.id] }, module: 'wms-zone' };
      const pickerQuery = { module: 'user-enquiry', code: { $in: [ownedPicker.code] } };
      const zoneBefore = await generic.find(zoneQuery).explain('executionStats');
      const pickerBefore = await generic.find(pickerQuery).explain('executionStats');
      await generic.createIndex({ id: 1 }, { unique: true, name: 'owned_generic_numeric_id_unique' });
      await generic.createIndex({ code: 1, module: 1 }, { name: 'owned_wms_picker_code_module', partialFilterExpression: { module: 'user-enquiry' } });
      const zoneAfter = await generic.find(zoneQuery).explain('executionStats');
      const pickerAfter = await generic.find(pickerQuery).explain('executionStats');
      assert.equal(zoneBefore.executionStats.nReturned, 2);
      assert.ok(zoneBefore.executionStats.totalDocsExamined >= 10001);
      assert.ok(zoneAfter.executionStats.totalDocsExamined <= 2);
      assert.equal(pickerBefore.executionStats.nReturned, 1);
      assert.ok(pickerBefore.executionStats.totalDocsExamined >= 10001);
      assert.equal(pickerAfter.executionStats.totalDocsExamined, 1);
      assert.equal((await mongo.findWmsPickerCandidates(['OWNED-PICKER'])).length, 1);
      console.log(JSON.stringify({ scope: 'OWNED_ZONE_PICKER_PLAN', rows: 10001, zone: { beforeDocs: zoneBefore.executionStats.totalDocsExamined, afterDocs: zoneAfter.executionStats.totalDocsExamined, afterKeys: zoneAfter.executionStats.totalKeysExamined }, picker: { beforeDocs: pickerBefore.executionStats.totalDocsExamined, afterDocs: pickerAfter.executionStats.totalDocsExamined, afterKeys: pickerAfter.executionStats.totalKeysExamined } }));
      await generic.deleteMany({ module: 'zone-plan-fixture' });
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        if (signal === 'SIGKILL') {
          const interrupted = new Error('Owned transaction interrupted before commit');
          await assert.rejects(mongo.mongoDomainTransaction(async (db, session) => {
            await db.collection('generic_records').updateOne({ id: record.id }, { $set: { uncommitted_marker: true } }, { session });
            await stopOwnedDaemon(signal);
            throw interrupted;
          }), error => error === interrupted);
        } else await stopOwnedDaemon(signal);
        const outageStarted = performance.now();
        await assert.rejects(mongo.findOne('generic_records', { id: record.id }), error => ['DATABASE_UNAVAILABLE', 'DATABASE_TIMEOUT'].includes(error.code) && [503, 504].includes(error.status));
        assert.ok(performance.now() - outageStarted < 20000, 'Outage read is bounded by the operation deadline plus test scheduling allowance');
        assert.notEqual(mongo.getMode(), 'memory', 'A configured outage cannot use memory');
        daemon = spawn('/opt/homebrew/bin/mongod', daemonArgs, { env, stdio: 'ignore' });
        daemon.on('error', error => { startError = error; });
        let recovered;
        for (let attempt = 0; attempt < 40; attempt++) {
          if (startError || daemon.exitCode !== null) throw new Error('Owned Mongo restart failed');
          try { recovered = await mongo.findOne('generic_records', { id: record.id }); break; }
          catch (error) { if (!['DATABASE_UNAVAILABLE', 'DATABASE_TIMEOUT'].includes(error.code)) throw error; await pause(250); }
        }
        assert.equal(recovered?.value, 'record business value');
        assert.equal(recovered?.revision, 1);
        assert.equal(recovered?.uncommitted_marker, undefined, 'Crash before commit cannot persist the transaction marker');
        console.log(`PASS: ${signal} daemon loss rejects without memory fallback; restart recovers the same persisted record.`);
      }
    } finally { await mongo.closeDataStore(); }
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  const { main: backup } = await import('./mongo-backup.mjs');
  const { main: restore } = await import('./mongo-restore.mjs');
  const toolEnv = { NODE_ENV: 'test', MONGODB_URI: `mongodb://127.0.0.1:${port}/mongo_boundaries_test?directConnection=true`, MONGODB_DB: 'mongo_boundaries_test' };
  const folder = join(directory, 'owned-backup');
  await client.db('mongo_boundaries_test').createCollection('owned_empty_collection');
  await backup(['--db', 'mongo_boundaries_test', '--out', folder, '--yes'], { env: toolEnv, output() {} });
  const restoreOutput = [];
  await restore(['--from', folder, '--target', 'mongo_restore_owned_test', '--yes'], { env: toolEnv, output: value => restoreOutput.push(JSON.parse(value)) });
  const source = client.db('mongo_boundaries_test'), restored = client.db('mongo_restore_owned_test');
  assert.deepEqual((await restored.listCollections().toArray()).map(row => row.name).sort(), (await source.listCollections().toArray()).map(row => row.name).sort());
  for (const { name } of await source.listCollections().toArray()) {
    assert.equal(await restored.collection(name).countDocuments(), await source.collection(name).countDocuments());
    const originalRows = source.collection(name).find({}).sort({ _id: 1 });
    const restoredRows = restored.collection(name).find({}).sort({ _id: 1 });
    try {
      for await (const original of originalRows) assert.equal(BSON.EJSON.stringify(await restoredRows.next(), { relaxed: false }), BSON.EJSON.stringify(original, { relaxed: false }));
      assert.equal(await restoredRows.next(), null);
    } finally { await originalRows.close(); await restoredRows.close(); }
  }
  assert.equal(restoreOutput[0].indexesRestored, false);
  assert.equal((await restored.collection('records').listIndexes().toArray()).some(index => index.name === 'owned_numeric_id_unique'), false);
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  await appendFile(join(folder, manifest.collections[0].file), '{"tampered":true}\n');
  await assert.rejects(restore(['--from', folder, '--target', 'mongo_corrupt_owned_test', '--yes'], { env: toolEnv, output() {} }), /integrity mismatch/);
  assert.equal((await client.db('mongo_corrupt_owned_test').listCollections().toArray()).length, 0, 'Corrupt backup must be rejected before target writes');
  const partialFolder = join(directory, 'owned-partial-backup');
  await mkdir(partialFolder, { mode: 0o700 });
  // A hash-valid reviewed file can still violate the target's built-in _id index.
  const partialRows = Array.from({ length: 500 }, (_, i) => ({ _id: i + 1, value: `owned-${i}` }));
  partialRows.push({ _id: 1, value: 'duplicate-owned-id' });
  const partialBytes = partialRows.map(row => BSON.EJSON.stringify(row, { relaxed: false }) + '\n').join('');
  await writeFile(join(partialFolder, '0.ndjson'), partialBytes, { mode: 0o600 });
  await writeFile(join(partialFolder, 'manifest.json'), JSON.stringify({ format: 'dmills-canonical-ejson-v1', complete: true,
    collections: [{ name: 'partial_fixture', file: '0.ndjson', count: 501, sha256: createHash('sha256').update(partialBytes).digest('hex') }] }), { mode: 0o600 });
  const partialOutput = [];
  await assert.rejects(restore(['--from', partialFolder, '--target', 'mongo_partial_owned_test', '--yes'], { env: toolEnv, output: value => partialOutput.push(value) }), error => error.code === 11000);
  assert.equal(partialOutput.length, 0, 'Partial restore must not emit a success report');
  assert.equal(await client.db('mongo_partial_owned_test').collection('partial_fixture').countDocuments(), 500, 'Committed first batch remains available for operator review');
  assert.equal((await client.db('mongo_partial_owned_test').collection('partial_fixture').findOne({ _id: 1 })).value, 'owned-0');
  await assert.rejects(restore(['--from', partialFolder, '--target', 'mongo_partial_owned_test', '--yes'], { env: toolEnv, output() {} }), /new database/);
  console.log('PASS: duplicate-key failure after first restore batch retains exactly 500 original documents, emits no success and refuses replay into partial target.');
  console.log('PASS: canonical backup/restore preserves collections including empty ones and every BSON document; corrupt backup rejected before writes; indexes remain unrestored.');
  console.log('PASS: owned Mongo replica; 10,000-row read, excess rejection, findOne, atomic update, bulk commit, aggregate-budget rollback.');
} finally {
  await client.close();
  await stopOwnedDaemon();
  await rm(directory, { recursive: true, force: true });
  console.log('Owned Mongo process and temporary data removed.');
}
