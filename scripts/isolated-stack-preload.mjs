import { validateTestStores } from './lib/isolated-stack-guard.mjs';
validateTestStores(process.env);
globalThis[Symbol.for('dmills.isolated.test')] = true;
// Deny non-loopback sockets even if an application tries to use a provider.
import net from 'node:net';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = net._normalizeArgs(args)[0];
  if (options.path || !['127.0.0.1', '::1', 'localhost'].includes(options.host || 'localhost')) throw new Error('Non-loopback test socket refused');
  return connect.apply(this, args);
};
