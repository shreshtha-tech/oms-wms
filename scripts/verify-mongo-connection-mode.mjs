import assert from 'node:assert/strict';
import { find, getMode, probeDataStore, waitForDataReady } from '../api/mongo.js';
import { persistenceRequired } from '../api/storage-policy.js';

if (persistenceRequired() && !process.env.MONGODB_URI) {
  await assert.rejects(waitForDataReady(), /MONGODB_URI is required when persistent storage is enforced/);
  await assert.rejects(probeDataStore(), /MONGODB_URI is required when persistent storage is enforced/);
  assert.equal(getMode(), 'unavailable');
  console.log('Production persistence enforcement refused the in-memory store.');
} else if (process.env.MONGODB_URI) {
  await assert.rejects(find('inventory'), /Configured MongoDB is unavailable/);
  await assert.rejects(probeDataStore(), /Configured MongoDB is unavailable/);
  assert.equal(getMode(), 'unavailable');
  console.log('Configured MongoDB outage refused legacy data operations.');
} else {
  assert.deepEqual(await find('inventory'), []);
  assert.equal(getMode(), 'memory');
  assert.equal(await waitForDataReady(), 'memory');
  assert.equal(await probeDataStore(), 'memory');
  console.log('Unconfigured development memory store started empty.');
}
