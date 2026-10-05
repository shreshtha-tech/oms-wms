import assert from 'node:assert/strict';
import { sealCredential } from '../inventory/credentials.js';
import { connectionView } from '../inventory/connections.js';
import { connectionCatalog } from '../inventory/connection-catalog.js';

const previous = process.env.INVENTORY_CREDENTIAL_KEY;
let checked = 0;
try {
  process.env.INVENTORY_CREDENTIAL_KEY = '33'.repeat(32);
  for (const config of connectionCatalog) {
    for (const field of config.fields.filter(field => field.secret)) {
      for (const value of ['x', 'xy', 'xyz', 'wxyz', 'fixture-secret-unique-tail']) {
        const sealed = sealCredential({ [field.key]: value });
        const view = connectionView({
          id: 'controlled-account', tenant_id: 'controlled-tenant', platform: config.key,
          external_account_id: 'controlled-identity', connection_state: 'verified',
          status: 'inactive', settings: {}, verification: {},
          encrypted_credentials: sealed.encrypted, credential_iv: sealed.iv, credential_tag: sealed.tag,
        });
        assert.equal(view.masked[field.key], '••••', 'secret mask must disclose no credential characters or length');
        assert.equal(Object.hasOwn(view.fields, field.key), false, 'secret must not appear among public fields');
        assert.equal(view.masked[field.key].includes(value), false);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
  console.log(`PASS ${checked} controlled saved-secret response cases across the connection catalog; no provider or database calls.`);
} finally {
  if (previous === undefined) delete process.env.INVENTORY_CREDENTIAL_KEY;
  else process.env.INVENTORY_CREDENTIAL_KEY = previous;
}
