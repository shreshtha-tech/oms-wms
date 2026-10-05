import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { sealCredential, openCredential } from '../inventory/credentials.js';
const prior = process.env.INVENTORY_CREDENTIAL_KEY;
const fixture = { accessToken: 'generated-crypto-fixture', clientSecret: 'generated-fixture-secret' };
const keyA = '11'.repeat(32), keyB = '22'.repeat(32);
const row = sealed => ({ encrypted_credentials: sealed.encrypted, credential_iv: sealed.iv, credential_tag: sealed.tag });
try {
  process.env.INVENTORY_CREDENTIAL_KEY = keyA;
  const sealed = sealCredential(fixture), another = sealCredential(fixture);
  assert.equal(sealed.iv.length, 12);
  assert.equal(sealed.tag.length, 16);
  assert.notDeepEqual(sealed.iv, another.iv);
  assert.deepEqual(openCredential(row(sealed)), fixture);
  for (const field of ['encrypted_credentials', 'credential_iv', 'credential_tag']) {
    const changed = row(sealed); changed[field] = Buffer.from(changed[field]); changed[field][0] ^= 1;
    assert.throws(() => openCredential(changed), `modified ${field} must reject rather than return plaintext`);
  }
  for (const length of [0, 4, 8, 12, 15]) assert.throws(() => openCredential({ ...row(sealed), credential_tag: sealed.tag.subarray(0,length) }), error => error.code === 'CREDENTIAL_DECRYPTION_FAILED');
  assert.throws(() => openCredential({ ...row(sealed), credential_tag: Buffer.concat([sealed.tag,Buffer.from([0])]) }), error => error.code === 'CREDENTIAL_DECRYPTION_FAILED');
  for (const credential_iv of [null, '', Buffer.alloc(8), Buffer.alloc(16)]) assert.throws(() => openCredential({ ...row(sealed), credential_iv }), error => error.code === 'CREDENTIAL_DECRYPTION_FAILED');
  process.env.INVENTORY_CREDENTIAL_KEY = keyB;
  assert.throws(() => openCredential(row(sealed)), 'a different key cannot silently open old ciphertext');
  delete process.env.INVENTORY_CREDENTIAL_KEY;
  assert.throws(() => openCredential(row(sealed)));
  assert.throws(() => sealCredential(fixture));
  process.env.INVENTORY_CREDENTIAL_KEY = 'invalid';
  assert.throws(() => openCredential(row(sealed)));
  process.env.INVENTORY_CREDENTIAL_KEY = keyA;
  assert.deepEqual(openCredential(row(sealed)), fixture, 'restored correct key retains durable ciphertext compatibility');
  assert.deepEqual(openCredential({ ...row(sealed), tenant_id: 'foreign-fixture-tenant', id: 'foreign-fixture-account' }), fixture);
  await writeFile('docs/reliability/credential-crypto-evidence.json', JSON.stringify({ at: new Date().toISOString(), layer: 'CONTROLLED_CRYPTO_FIXTURE', correctKey: true, randomIvAndTagSize: true, strictIvAndFullTagFormat: true, safeDecryptionError: true, modifiedCiphertextIvTagRejected: true, missingInvalidWrongKeyRejected: true, correctKeyRestoration: true, tenantAccountAadBinding: false, formatVersionAndKeyId: false, automaticRotationMigration: false, providerAuthenticationProven: false, limitations: ['No provider call performed', 'No configured credentials changed', 'Multi-process deployment/key rollout and explicit re-encryption migration remain unverified'] }, null, 2) + '\n');
  console.log('PASS controlled crypto integrity/failure checks; UNRESOLVED tenant/account AAD, format/key versioning and rotation migration. No provider proof.');
} finally { if (prior === undefined) delete process.env.INVENTORY_CREDENTIAL_KEY; else process.env.INVENTORY_CREDENTIAL_KEY = prior; }
