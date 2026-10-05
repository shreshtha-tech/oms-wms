import '../env.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const review=JSON.parse(readFileSync('docs/reliability/credential-pattern-review.json','utf8'));
const ids=new Set(['C076','C079','C080','C094','C095','C096']);
const configured=Object.entries(process.env).filter(([key,value])=>/secret|password|token|credential|(?:database|mongodb).*url|mongodb_uri/i.test(key)&&typeof value==='string'&&value.length);
const privateValues=configured.map(([,value])=>value);
for(const [,value] of configured){
 try {const url=new URL(value);if(url.password)privateValues.push(decodeURIComponent(url.password));}catch{}
}
const objects=new Map();
for(const row of review.candidates.filter(row=>ids.has(row.candidateId))){
 for(const reference of row.sourceReferences){
  if(!reference.objectId)continue;
  if(!objects.has(reference.objectId)){
   const text=execFileSync('git',['cat-file','blob',reference.objectId],{maxBuffer:8_000_000}).toString('utf8');
   const password=text.match(/Example password used in this project:\s*`([^`]+)`/i)?.[1];
   // URI metadata only; neither values nor content hashes of credential literals leave memory.
   const uriRecords=[...text.matchAll(/(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/[^\s`]+/g)].map(match=>{
    let parsed;try{parsed=new URL(match[0]);}catch{return {parseable:false,authenticity:'UNKNOWN'};}
    let candidate;try{candidate=decodeURIComponent(parsed.password);}catch{candidate=parsed.password;}
    return {parseable:true,passwordPresent:Boolean(candidate),explicitPlaceholder:/YOUR_PASSWORD|PASSWORD_HERE|<[^>]+>/i.test(candidate),passwordMatchesCurrentPrivateConfiguration:Boolean(candidate&&privateValues.includes(candidate)),hostLooksPlaceholder:/cluster0\.xxxxx|example\.(com|net|org)/i.test(parsed.hostname),authenticity:'UNKNOWN'};
   });
   objects.set(reference.objectId,{objectId:reference.objectId,standalonePasswordLiteralPresent:Boolean(password),standalonePasswordMatchesCurrentPrivateConfiguration:Boolean(password&&privateValues.includes(password)),uriRecords,candidates:[],limits:'Equality against current environment only; no provider authentication, historical use, expired secrets or database-vault comparison established'});
  }
  objects.get(reference.objectId).candidates.push({candidateId:row.candidateId,sourceLayer:row.sourceLayer,path:row.file,line:row.line});
 }
}
const result={at:new Date().toISOString(),layer:'READ_ONLY_LOCAL_HISTORY_AND_PRIVATE_ENV_COMPARISON',objects:[...objects.values()],credentialAuthenticity:'UNKNOWN',rotationRelevance:'UNKNOWN',noCredentialValuesEmitted:true,noHistoryOrCredentialChanges:true};
writeFileSync('docs/reliability/historical-guide-credential-evidence.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({objects:objects.size,standalonePasswordLiteralObjects:[...objects.values()].filter(o=>o.standalonePasswordLiteralPresent).length,currentPrivateValueMatch:[...objects.values()].some(o=>o.standalonePasswordMatchesCurrentPrivateConfiguration||o.uriRecords.some(u=>u.passwordMatchesCurrentPrivateConfiguration)),authenticity:'UNKNOWN'}));
