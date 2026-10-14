import assert from 'node:assert/strict';
import { publicationStatusError } from '../inventory/publication-status-error.js';

for (const code of ['42P01','42703']) {
  const result=publicationStatusError({ code, message: 'private SQL and connection detail' });
  assert.equal(result.status,503);
  assert.equal(result.body.code,'PUBLICATION_SCHEMA_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result.body),/private|connection detail/);
}
assert.equal(publicationStatusError({ code: '57014' }).status,504);
assert.equal(publicationStatusError({ code: '53300' }).body.code,'PUBLICATION_DATABASE_UNAVAILABLE');
assert.equal(publicationStatusError({ code: '08006' }).body.code,'PUBLICATION_DATABASE_UNAVAILABLE');
assert.equal(publicationStatusError(new Error('private query text')).body.code,'PUBLICATION_QUERY_FAILED');
console.log('PASS: publication failures distinguish schema, timeout, dependency and unknown errors without exposing SQL detail');
