import '../env.js';
import { MongoClient } from 'mongodb';
import { resolveSrv } from 'node:dns/promises';
import { spawn } from 'node:child_process';
const client=new MongoClient(process.env.MONGODB_URI);
const endpoints=client.options.srvHost?(await resolveSrv(`_mongodb._tcp.${client.options.srvHost}`)).map(r=>({host:r.name,port:r.port})):client.options.hosts.map(r=>({host:r.host,port:r.port}));
const results=[];
for(const[index,endpoint]of endpoints.slice(0,3).entries()){
 const child=spawn('/usr/bin/openssl',['s_client','-connect',`${endpoint.host}:${endpoint.port}`,'-servername',endpoint.host,'-verify_return_error','-tls1_2','-msg'],{stdio:['pipe','pipe','pipe']});
 let captured='',expired=false;for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{captured=(captured+String(chunk)).slice(-100000);});child.stdin.end();
 const deadline=setTimeout(()=>{expired=true;child.kill('SIGTERM');},6000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});clearTimeout(deadline);
 // Raw TLS trace/certificate content is never printed or persisted.
 results.push({endpoint:index+1,implementation:'system LibreSSL',sniProvided:true,verificationRequired:true,tlsVersion:'TLSv1.2',exitCode:code,timedOut:expired,clientHelloSent:/ClientHello/.test(captured),serverHelloReceived:/ServerHello/.test(captured),certificateReceived:/Handshake.*Certificate\b|\bServer certificate\b|BEGIN CERTIFICATE/.test(captured),alert80:/alert number 80|fatal internal_error|Alert[^\n]*\n\s*02\s+50/i.test(captured),internalErrorAlert:/alert internal error|internal_error/i.test(captured),certificateNotPresented:/no peer certificate available/.test(captured)});
}
await client.close();console.log(JSON.stringify({at:new Date().toISOString(),readOnly:true,results},null,2));
if(results.some(r=>r.exitCode!==0||!r.certificateReceived))process.exitCode=1;
