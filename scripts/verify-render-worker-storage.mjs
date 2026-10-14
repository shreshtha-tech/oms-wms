import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
const blueprint = yaml.load(await readFile(new URL('../render.yaml', import.meta.url), 'utf8'));
const web = blueprint.services.find(service => service.type === 'web');
const worker = blueprint.services.find(service => service.type === 'worker');
const settings = service => Object.fromEntries(service.envVars.map(setting => [setting.key, setting]));
const webSettings = settings(web), workerSettings = settings(worker);
for (const values of [webSettings, workerSettings]) {
  assert.equal(values.DMILLS_REQUIRE_PERSISTENCE.value, 'true');
  assert.equal(values.MONGODB_URI.sync, false);
  assert.equal(values.MONGODB_URI.value, undefined, 'Mongo credentials must be supplied privately');
  assert.ok(values.MONGODB_DB.value);
}
assert.equal(workerSettings.MONGODB_DB.value, webSettings.MONGODB_DB.value);
assert.equal(workerSettings.NODE_VERSION.value, webSettings.NODE_VERSION.value);
assert.match(worker.startCommand, /inventory-worker-supervisor/);
console.log('PASS: web and receipt worker declare matching Mongo database selection, required persistence and private URI configuration. Hosted values remain unverified.');
