import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { whatsappFetch } from '../inventory/whatsapp.js';
const originalRequest=https.request,originalLookup=dns.lookup;
try{
 for(const scenario of ['dns','private-dns','tls','dispatched-loss','accepted','oversize']){
  let dispatched=false,requests=0;
  dns.lookup=async()=>{if(scenario==='dns')throw Error('fixture DNS failure');return [{address:scenario==='private-dns'?'127.0.0.1':'8.8.8.8',family:4}];};
  syncBuiltinESMExports();
  https.request=(url,options,onResponse)=>{
   requests++;assert.equal(url.origin,'https://graph.facebook.com');assert.equal(options.onDispatch,undefined);
   const request=new EventEmitter();request.setTimeout=milliseconds=>assert.equal(milliseconds,20000);
   request.destroy=error=>queueMicrotask(()=>request.emit('error',error));
   request.end=body=>{assert.equal(body,'fixture-body');queueMicrotask(()=>{
    if(scenario==='tls'){request.emit('error',Error('fixture TLS failure'));return;}
    request.emit('finish');
    if(scenario==='dispatched-loss'){request.emit('error',Error('fixture connection lost'));return;}
    const response=new EventEmitter();response.statusCode=200;onResponse(response);
    response.emit('data',scenario==='oversize'?Buffer.alloc(4_000_001):Buffer.from('{"messages":[{"id":"wamid.fixture"}]}'));
    if(scenario!=='oversize')response.emit('end');
   });};
   return request;
  };
  if(scenario==='accepted'){
   const response=await whatsappFetch('https://graph.facebook.com/v23.0/123/messages',{body:'fixture-body',onDispatch:()=>{dispatched=true;}});
   assert.equal((await response.json()).messages[0].id,'wamid.fixture');
  }else await assert.rejects(()=>whatsappFetch('https://graph.facebook.com/v23.0/123/messages',{body:'fixture-body',onDispatch:()=>{dispatched=true;}}));
  assert.equal(dispatched,['dispatched-loss','accepted','oversize'].includes(scenario),scenario);
  assert.equal(requests,['dns','private-dns'].includes(scenario)?0:1);
 }
 await assert.rejects(()=>whatsappFetch('https://user:password@graph.facebook.com/v23.0/123/messages'),/Invalid Meta origin/);
 console.log('PASS fake Node HTTPS transport: DNS/TLS failures before dispatch, request-finish signal, post-dispatch loss, acceptance, response size cap and credential-free fixed origin; no network calls');
}finally{dns.lookup=originalLookup;https.request=originalRequest;syncBuiltinESMExports();}
