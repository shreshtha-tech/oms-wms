import { providerCall } from '../reliability/provider-call.js';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !([0,10,127].includes(a) || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&[0,168].includes(b)) || (a===100&&b>=64&&b<=127) || (a===198&&[18,19].includes(b)));
  }
  // Merchant hostnames may use global IPv6; reject local and IPv4-mapped ranges.
  return isIP(address) === 6 && /^2[0-9a-f]{3}:/i.test(address);
}
export function httpsOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS store URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash || url.search || url.pathname !== '/') throw new Error('Use an HTTPS origin without a path, port, query or credentials');
  if (isIP(url.hostname) || !url.hostname.includes('.') || /\.(localhost|local|internal)$/i.test(url.hostname)) throw new Error('Use a public store hostname');
  return url.origin;
}
// Resolve once, reject private addresses, and pin the checked address to prevent DNS rebinding.
// Never follow redirects with provider credentials.
export async function providerFetch(input, options={}) {
  const url = new URL(input);
  const provider = /shopify/.test(url.hostname) ? 'shopify' : /amazon/.test(url.hostname) ? 'amazon' : /flipkart/.test(url.hostname) ? 'flipkart' : /facebook/.test(url.hostname) ? 'meta' : 'merchant';
  const safeToRetry = ['GET','HEAD'].includes(options.method || 'GET') || options.retrySafe === true;
  return providerCall(() => providerFetchOnce(input, options), { provider, safeToRetry, circuitKey: url.origin });
}
async function providerFetchOnce(input, options={}) {
  const url = new URL(input);
  httpsOrigin(url.origin);
  const deadline = AbortSignal.timeout(20000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const answers = await new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('Provider connection timed out.'), { name: 'TimeoutError' }));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    lookup(url.hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  if (!answers.length || answers.some(answer=>!publicAddress(answer.address))) throw new Error('Provider hostname resolves to a non-public address');
  const chosen = answers[0];
  return new Promise((resolve,reject)=>{
    const { retrySafe, onDispatch, ...transportOptions } = options;
    const request = https.request(url, {...transportOptions, signal, lookup:(_host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)}, response=>{
      const chunks=[]; let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>4_000_000){request.destroy(new Error('Provider response exceeds 4 MB'));return;}chunks.push(chunk);});
      response.on('end',()=>{const bytes=Buffer.concat(chunks);resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,headers:new Headers(response.headers),json:async()=>{
        try { return JSON.parse(bytes.toString()); }
        catch { throw Object.assign(new Error('The provider returned an invalid JSON response.'), { status:502, code:'PROVIDER_INVALID_RESPONSE' }); }
      },text:async()=>bytes.toString()});});
      response.on('error',reject);
    });
    request.setTimeout(20000,()=>request.destroy(Object.assign(new Error('Provider request timed out.'), { name:'TimeoutError', code:'ETIMEDOUT', status:504 })));
    request.on('error',reject);
    if(options.body)request.write(options.body instanceof URLSearchParams?options.body.toString():options.body);
    onDispatch?.();
    request.end();
  });
}
export function redact(value, secrets=[]) {
  if (Array.isArray(value)) return value.slice(0,100).map(item=>redact(item,secrets));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key])=>!/^(__proto__|constructor|prototype)$/.test(key)).map(([key,item])=>[key,/token|secret|password|authorization|cookie|api.?key|credential/i.test(key)?'[redacted]':redact(item,secrets)]));
  if (typeof value==='string') {
    let text=value;
    for(const secret of secrets.filter(item=>typeof item==='string'&&item.length>3))text=text.split(secret).join('[redacted]');
    return text.replace(/(?:shpat_|shpca_|shpss_|ck_|cs_)[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,3000);
  }
  return value;
}
export async function jsonResponse(response, provider) {
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(`${provider} request failed (HTTP ${response.status})`),{status:422,providerStatus:response.status,diagnostic:body});
  if(!body)throw Object.assign(new Error(`${provider} returned an invalid JSON response`),{status:502,code:'PROVIDER_INVALID_RESPONSE'});
  return body;
}
