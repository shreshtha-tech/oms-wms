if (process.env.NODE_ENV !== 'test' || process.env.DMILLS_SKIP_DOTENV !== 'true') throw new Error('CI isolation preload requires explicit test mode');
globalThis[Symbol.for('dmills.isolated.test')] = true;
import net from 'node:net';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
 const options = net._normalizeArgs(args)[0];
 if (options.path || !['127.0.0.1','::1','localhost'].includes(options.host || 'localhost') || [3002,5173,5432,27017].includes(Number(options.port))) throw new Error('Baseline refuses configured service or non-loopback socket');
 return connect.apply(this,args);
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || [3002,5173,5432,27017].includes(Number(url.port))) throw new Error('Baseline refuses configured service or non-loopback fetch');
 return fetch(input,...args);
};
import { chromium } from 'playwright';
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
 const browser = await launch(...args);
 const newContext = browser.newContext.bind(browser);
 browser.newContext = async (...args) => {
  const context = await newContext(...args);
  await context.route('**/*', route => {
   const url=new URL(route.request().url());
   if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || [3002,5173].includes(Number(url.port))) return route.abort();
   return route.continue();
  });
  return context;
 };
 browser.newPage = async options => { const context=await browser.newContext(options); return context.newPage(); };
 return browser;
};
