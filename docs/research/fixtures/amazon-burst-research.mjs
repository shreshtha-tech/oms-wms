import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const root='/Users/shreshthagupta/AI-Workspaces/oms-wms';
globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};
const {AmazonConnector}=await import(root+'/inventory/connectors/amazon.js');
const calls=[];
const originalNow=Date.now;
Date.now=()=>1000000;
try{
 const connector=new AmazonConnector({sellerId:'synthetic-seller',marketplaceId:'synthetic-market',fetcher:async(url,options)=>{calls.push({method:options.method,path:new URL(url).pathname,time:Date.now()});return {ok:true,json:async()=>({status:'ACCEPTED',sku:'synthetic-sku'})};}});
 connector.token='synthetic-not-a-real-token';connector.tokenExpires=2000000;
 for(let n=0;n<6;n++)await connector.patchMfnQuantity({sellerSku:'synthetic-sku',quantity:n,fulfillmentChannelCode:'DEFAULT'});
 assert.equal(calls.length,6);assert.ok(calls.every(c=>c.time===1000000&&c.method==='PATCH'));
 process.stdout.write(JSON.stringify({scope:'Offline actual AmazonConnector with stub fetch and fixed clock; rateControl omitted to isolate its built-in limiter; no DB or provider access',result:'CONFIRMED_LOCAL_LIMITER_ACCEPTS_SIX_WITHOUT_CLOCK_ADVANCE',documentedDefaultBurst:5,observedRequests:6,remainingTokens:connector.patchTokens,calls,sourceSha256:createHash('sha256').update(await readFile(root+'/inventory/connectors/amazon.js')).digest('hex')},null,2)+'\n');
}finally{Date.now=originalNow;}
