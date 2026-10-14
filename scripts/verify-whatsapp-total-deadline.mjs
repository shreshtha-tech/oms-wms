import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { whatsappFetch } from '../inventory/whatsapp.js';
let destroyed = false, dispatched = 0, drip;
const request = (_url, _options, callback) => {
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.destroy = error => { destroyed = true; clearInterval(drip); req.emit('error', error); };
  req.end = () => {
    req.emit('finish');
    const response = new EventEmitter(); response.statusCode = 200; callback(response);
    drip = setInterval(() => response.emit('data', Buffer.from(' ')), 5);
  };
  return req;
};
const start = performance.now();
await assert.rejects(whatsappFetch('https://graph.facebook.com/v23.0/messages', { onDispatch: () => dispatched++ }, { request, lookup: async () => [{ address: '8.8.8.8', family: 4 }], totalTimeoutMs: 40 }), /total request deadline/);
assert.equal(destroyed, true);
assert.equal(dispatched, 1);
assert.ok(performance.now() - start < 1000);
let sent = false;
await assert.rejects(whatsappFetch('https://graph.facebook.com/v23.0/messages', {}, { lookup: () => new Promise(() => {}), request: () => { sent = true; }, totalTimeoutMs: 20 }), /DNS lookup timed out/);
assert.equal(sent, false);
console.log('PASS: slow-drip response hits total deadline and destroys request; stalled DNS rejects before dispatch.');
