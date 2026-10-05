import assert from 'node:assert/strict';
import { credentialRequest } from '../src/lib/credentialRequest.ts';
for (const outcome of ['success', 'provider-rejection', 'transport-failure']) {
  const fields = { store: 'fixture-store', accessToken: 'generated-fixture-secret' };
  let cleared = 0;
  const request = credentialRequest(async () => {
    assert.ok(fields.accessToken, 'secret remains available for the submitted request');
    if (outcome !== 'success') throw new Error(outcome);
    return { accepted: true };
  }, () => { fields.accessToken = ''; cleared++; });
  if (outcome === 'success') assert.deepEqual(await request, { accepted: true });
  else await assert.rejects(request, error => error.message === outcome);
  assert.equal(cleared, 1);
  assert.equal(fields.accessToken, '');
  assert.equal(fields.store, 'fixture-store', 'non-secret setup survives request failure');
}
console.log('PASS credential submission boundary: success/rejection/transport error clear submitted secrets while preserving setup and request result/error. Dynamic browser acceptance remains separate.');
