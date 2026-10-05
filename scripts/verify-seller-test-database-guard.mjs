import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for (const suite of ['scripts/verify-seller-connections.mjs', 'scripts/verify-inventory-publish-order.mjs', 'scripts/verify-return-without-order.mjs']) for (const url of ['postgres://test_user:test_password@localhost:1/production', 'postgres://fixture:fixture@remote.example.com/test_contract']) {
  const result = spawnSync(process.execPath, [suite], {
    env: { ...process.env, INVENTORY_DATABASE_URL: url, MONGODB_URI: '' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('Use a local isolated test/contract inventory database'));
  assert.ok(!result.stdout.includes('READY'));
}
console.log('PASS seller/publication database guards rejects username/password markers and remote test databases before migration');
