import assert from 'node:assert/strict';
import { loginLimit } from '../reliability/login-limiter.js';
let nextCalls = 0;
for (const body of [undefined, {}, { username: [], password: 'fixture' }, { username: 'fixture', password: [] }, { username: true, password: 'fixture' }, { username: 'fixture', password: {} }, { username: null, password: 1 }]) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await loginLimit({ body }, response, () => { nextCalls++; });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'VALIDATION_ERROR');
  assert.match(response.body.message, /must be text/);
}
assert.equal(nextCalls, 0);
console.log('PASS: malformed login fields rejected before rate-limit database or credential verification');
