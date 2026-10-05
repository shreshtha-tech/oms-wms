import '../env.js';
import { resolveSrv, resolveTxt, lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { MongoClient } from 'mongodb';
const uri=process.env.MONGODB_URI;
const result={at:new Date().toISOString(),runtime:process.version,readOnly:true,configuration:{uriPresent:Boolean(uri),databasePresent:Boolean(process.env.MONGODB_DB),outerWhitespace:Boolean(uri&&uri!==uri.trim()),extraCaConfigured:Boolean(process.env.NODE_EXTRA_CA_CERTS),proxyConfigured:Boolean(process.env.HTTPS_PROXY||process.env.HTTP_PROXY),tlsVerificationDisabled:process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'},endpoints:[]};
const classification=error=>({name:/^[A-Za-z0-9_]{1,80}$/.test(error?.name||'')?error.name:'Error',code:/^[A-Za-z0-9_]{1,80}$/.test(String(error?.code||''))?error.code:undefined,tlsAlert:/alert number (\d+)/.exec(error?.message||'')?.[1],...(error?.cause?{cause:classification(error.cause)}:{})});
function socketProbe(host,port,options){return new Promise(resolve=>{
 const started=performance.now();let settled=false;
 const complete=value=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();resolve({...value,durationMs:Math.round(performance.now()-started)});};
 const socket=options?tls.connect({host,port,servername:host,rejectUnauthorized:true,...options}):net.connect({host,port});
 const timer=setTimeout(()=>complete({ok:false,error:{code:'DIAGNOSTIC_TIMEOUT'}}),5000);
 socket.once('error',error=>complete({ok:false,error:classification(error)}));
 socket.once(options?'secureConnect':'connect',()=>complete(options?{ok:true,authorized:socket.authorized,protocol:socket.getProtocol(),cipher:socket.getCipher()?.name}:{ok:true,family:socket.remoteFamily}));
 });}
let client;
try{
 if(!uri)throw Object.assign(new Error('Missing configured URI'),{code:'MISSING_MONGODB_URI'});
 client=new MongoClient(uri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:5000,maxPoolSize:1,minPoolSize:0});
 result.configuration.uriParsed=true;result.configuration.scheme=uri.startsWith('mongodb+srv://')?'mongodb+srv':'mongodb';
 result.configuration.driverTlsEnabled=Boolean(client.options.tls);
 result.configuration.credentialsPresent=Boolean(client.options.credentials);
 let endpoints;
 if(client.options.srvHost){
  try{const records=await resolveSrv(`_mongodb._tcp.${client.options.srvHost}`);result.dns={srv:true,count:records.length};endpoints=records.map(record=>({host:record.name,port:record.port}));}
  catch(error){result.dns={srv:false,error:classification(error)};endpoints=[];}
  try{const records=await resolveTxt(client.options.srvHost);result.dns.txtResolved=true;result.dns.txtRecordCount=records.length;}catch(error){result.dns.txtResolved=false;result.dns.txtError=classification(error);}
 }else endpoints=client.options.hosts.map(address=>({host:address.host,port:address.port}));
 for(const [index,endpoint]of endpoints.slice(0,3).entries()){
  const check={endpoint:index+1};
  try{const addresses=await lookup(endpoint.host,{all:true});check.dns={ok:true,ipv4:addresses.filter(a=>a.family===4).length,ipv6:addresses.filter(a=>a.family===6).length};}catch(error){check.dns={ok:false,error:classification(error)};}
  check.tcp=await socketProbe(endpoint.host,endpoint.port);
  check.tlsDefault=await socketProbe(endpoint.host,endpoint.port,{minVersion:'TLSv1.2'});
  check.tls12=await socketProbe(endpoint.host,endpoint.port,{minVersion:'TLSv1.2',maxVersion:'TLSv1.2'});
  check.tls13=await socketProbe(endpoint.host,endpoint.port,{minVersion:'TLSv1.3',maxVersion:'TLSv1.3'});
  result.endpoints.push(check);
 }
 try{await client.connect();await client.db(process.env.MONGODB_DB).command({ping:1});result.driver={authenticatedPing:true,configuredDatabaseSelected:true};}
 catch(error){result.driver={authenticatedPing:false,error:classification(error),servers:[...error?.reason?.servers?.values?.()||[]].map(server=>classification(server.error))};}
}catch(error){result.error=classification(error);}
finally{if(client)await client.close().catch(()=>{});}
console.log(JSON.stringify(result,null,2));
if(!result.driver?.authenticatedPing)process.exitCode=1;
