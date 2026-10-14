import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/context/AuthContext.tsx', import.meta.url), 'utf8');
const pending = [], listeners = new Map(), states = [];
let stateIndex = 0;
const react = { createContext: () => ({ Provider: 'fixture-provider' }), useContext() {},
  useRef: value => ({ current: value }), useState: value => { const index = stateIndex++; states[index] = value; return [value, next => { states[index] = next; }]; },
  useEffect: effect => effect() };
const exports = {};
new Function('exports', 'require', 'fetch', 'window', 'document', 'localStorage', 'sessionStorage',
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(exports,
  name => name === 'react' ? react : { jsx: (_type, props) => props },
  path => new Promise(resolve => pending.push({ path, resolve })),
  { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} },
  { addEventListener() {}, removeEventListener() {} }, { removeItem() {} }, { removeItem() {} });
const context = exports.AuthProvider({ children: null }).value;
const settle = async (index, user, extra = {}) => { pending[index].resolve({ ok: true, json: async () => ({ user, ...extra }) }); for (let i = 0; i < 8; i++) await Promise.resolve(); };
await settle(0, null);
listeners.get('focus')();
const login = context.login('owned-user', 'synthetic-password');
await settle(2, { username: 'owned-user' });
assert.equal((await login).ok, true);
await settle(1, null);
assert.deepEqual(states[0], { username: 'owned-user' }, 'A pre-login null refresh cannot erase successful sign-in');
listeners.get('focus')();
listeners.get('focus')();
await settle(4, { username: 'owned-user' });
await settle(3, null);
assert.deepEqual(states[0], { username: 'owned-user' }, 'Older refresh cannot overwrite newer refresh');
const lateLogin = context.login('owned-user', 'synthetic-password');
const logout = context.logout();
await settle(6, null, { ok: true }); await logout;
await settle(5, { username: 'owned-user' });
assert.equal((await lateLogin).ok, false);
assert.equal(states[0], null, 'Late login response cannot undo newer sign-out');
const unavailable = context.login('owned-user', 'synthetic-password');
pending[7].resolve({ ok: false, json: async () => ({ error: 'AUTH_SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable.' }) });
assert.deepEqual(await unavailable, { ok: false, error: 'Sign-in is temporarily unavailable.' });
const incomplete = context.login('owned-user', 'synthetic-password');
pending[8].resolve({ ok: true, json: async () => ({}) });
assert.match((await incomplete).error, /response was incomplete/);
assert.deepEqual(states[0], null, 'Incomplete successful response cannot mark a user signed in');
const nonJson = context.login('owned-user', 'synthetic-password');
pending[9].resolve({ ok: false, status: 502, json: async () => { throw Error('HTML gateway response'); } });
assert.deepEqual(await nonJson, { ok: false, error: 'Sign-in service returned HTTP 502.' });
const lostResponse = context.login('owned-user', 'synthetic-password');
pending[10].resolve(Promise.reject(Error('synthetic transport loss')));
assert.match((await lostResponse).error, /outcome is unknown/);
const signedIn = context.login('owned-user', 'synthetic-password');
await settle(11, { username: 'owned-user' });
assert.equal((await signedIn).ok, true);
const rejectedLogout = context.logout();
pending[12].resolve({ ok: false, json: async () => ({ error: 'Session database unavailable' }) });
await assert.rejects(rejectedLogout, /Sign-out failed/);
assert.deepEqual(states[0], { username: 'owned-user' }, 'Failed server revocation cannot be presented as local sign-out');
const unknownLogout = context.logout();
pending[13].resolve(Promise.reject(new Error('synthetic transport loss')));
await assert.rejects(unknownLogout, /outcome is unknown/);
assert.deepEqual(states[0], { username: 'owned-user' }, 'Unknown revocation outcome must remain visible');
const completedLogout = context.logout();
await settle(14, null, { ok: true });
await completedLogout;
assert.equal(states[0], null);
const shell = await readFile(new URL('../src/eretail/Shell.tsx', import.meta.url), 'utf8');
assert.match(shell, /try \{ await logout\(\); nav\('\/'\); \}/);
assert.doesNotMatch(shell, /logout\(\)\.finally\(/);
console.log('PASS: actual AuthProvider fences stale refresh/login and keeps failed or uncertain sign-out visible until server acknowledgement');
