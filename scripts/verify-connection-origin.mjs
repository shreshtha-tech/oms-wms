import assert from 'node:assert/strict';
import { connectionRequestOriginAllowed } from '../inventory/connection-origin.js';

const request = (origin, remoteAddress = '127.0.0.1', host = 'localhost:3002') => ({
  get(name) { return name === 'origin' ? origin : name === 'host' ? host : undefined; },
  protocol: 'http',
  socket: { remoteAddress },
});

assert.equal(connectionRequestOriginAllowed(request('http://localhost:5173')), true);
assert.equal(connectionRequestOriginAllowed(request('http://127.0.0.1:5174')), true);
assert.equal(connectionRequestOriginAllowed(request('http://localhost:3002')), true);
assert.equal(connectionRequestOriginAllowed(request('http://evil.example')), false);
assert.equal(connectionRequestOriginAllowed(request('null')), false);
assert.equal(connectionRequestOriginAllowed(request('http://localhost:5173.evil.example')), false);
assert.equal(connectionRequestOriginAllowed(request('http://localhost:5173'), { production: true }), false);
assert.equal(connectionRequestOriginAllowed(request('http://localhost:5173', '10.0.0.5')), false);
assert.equal(connectionRequestOriginAllowed(request('https://app.example.com'), { publicOrigin: 'https://app.example.com', production: true }), true);
assert.equal(connectionRequestOriginAllowed({ ...request('https://service.onrender.com', '10.0.0.5', 'service.onrender.com'), protocol: 'https' }, { publicOrigin: 'https://app.example.com', production: true }), true);
assert.equal(connectionRequestOriginAllowed({ ...request('https://evil.example', '10.0.0.5', 'service.onrender.com'), protocol: 'https' }, { publicOrigin: 'https://app.example.com', production: true }), false);
assert.equal(connectionRequestOriginAllowed(request('https://evil.example'), { publicOrigin: 'https://app.example.com', production: true }), false);
assert.equal(connectionRequestOriginAllowed(request('http://localhost:5173'), { publicOrigin: 'https://app.example.com' }), false);
console.log('PASS connection origin: local Vite proxy, direct origin, production and remote-client rejection');
