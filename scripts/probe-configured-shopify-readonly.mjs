import '../env.js';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { openCredential } from '../inventory/credentials.js';
import { providerFetch } from '../inventory/connection-security.js';
import { ShopifyConnector } from '../inventory/connectors/shopify.js';
const pool=new pg.Client({connectionString:process.env.INVENTORY_DATABASE_URL,connectionTimeoutMillis:8000,statement_timeout:10000});
const reference=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12);
const output={at:new Date().toISOString(),readOnly:true,scope:process.argv.includes('--authenticate')?'Private client-credential token issuance in memory followed by identity/scope read only; no token refresh, DB persistence, activation, webhook, order or stock writes':'Existing access-token identity/scope read only; no refresh or writes',accounts:[]};
let rows=[];
try{await pool.connect();await pool.query('BEGIN READ ONLY');rows=(await pool.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='shopify' ORDER BY id LIMIT 3",[process.env.INVENTORY_ALLOWED_TENANT_ID])).rows;await pool.query('ROLLBACK');}
catch(error){await pool.query('ROLLBACK').catch(()=>{});output.databaseError={code:error.code||error.name};}
finally{await pool.end();}
for(const row of rows){
 const evidence={accountReference:reference(row.id),storedStatus:row.status,storedConnectionState:row.connection_state,storedVerificationAt:row.verified_at,authenticated:false,identityMatched:false,scopeReadProven:false,inventoryWriteProven:false,providerReadbackProven:false};
 try{
  const credentials=openCredential(row);evidence.vaultDecrypted=true;evidence.credentialTypesPresent=['accessToken','clientId','clientSecret','refreshToken','shop','apiVersion'].filter(key=>Boolean(credentials[key]));
  if(!credentials.accessToken){
   if(process.argv.includes('--authenticate')&&credentials.clientId&&credentials.clientSecret){
    evidence.authenticationMechanism='client_credentials';
    const connector=new ShopifyConnector({shop:row.external_account_id,clientId:credentials.clientId,clientSecret:credentials.clientSecret,fetcher:providerFetch});
    const data=await connector.graphql('query{shop{id myshopifyDomain}currentAppInstallation{accessScopes{handle}}}');
    evidence.authenticated=Boolean(data?.shop?.id);evidence.identityMatched=data?.shop?.myshopifyDomain===row.external_account_id;
    evidence.scopeReadProven=Array.isArray(data?.currentAppInstallation?.accessScopes);
    evidence.scopeHandles=data?.currentAppInstallation?.accessScopes?.map(scope=>scope.handle).filter(value=>typeof value==='string'&&/^[a-z_]+$/.test(value))||[];
    evidence.result=evidence.authenticated&&evidence.identityMatched?'AUTHENTICATED_READ_IDENTITY_MATCHED':'PROVIDER_IDENTITY_NOT_PROVEN';
    try {
     const locations=await connector.graphql('query{locations(first:1){nodes{id name}pageInfo{hasNextPage}}}');
     evidence.locationReadProven=Array.isArray(locations?.locations?.nodes);evidence.sampleLocationCount=locations?.locations?.nodes?.length||0;
    }catch(error){evidence.locationReadProven=false;evidence.locationReadFailure={name:error.name,providerStatus:error.providerStatus};}

   }else evidence.result='EXISTING_ACCESS_TOKEN_MISSING; no refresh attempted';
   output.accounts.push(evidence);continue;
  }
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(row.external_account_id))throw Object.assign(new Error('Invalid stored shop identity'),{code:'STORED_IDENTITY_INVALID'});
  const response=await providerFetch(`https://${row.external_account_id}/admin/api/2026-07/graphql.json`,{method:'POST',retrySafe:true,headers:{'Content-Type':'application/json','X-Shopify-Access-Token':credentials.accessToken},body:JSON.stringify({query:'query{shop{id myshopifyDomain}currentAppInstallation{accessScopes{handle}}}'}),signal:AbortSignal.timeout(10000)});
  evidence.httpStatus=response.status;
  let payload;try{payload=await response.json();}catch{evidence.result='INVALID_PROVIDER_JSON';}
  if(response.ok&&payload?.data?.shop?.id){evidence.authenticated=true;evidence.identityMatched=payload.data.shop.myshopifyDomain===row.external_account_id;evidence.scopeReadProven=Array.isArray(payload.data.currentAppInstallation?.accessScopes);evidence.scopeHandles=payload.data.currentAppInstallation?.accessScopes?.map(scope=>scope.handle).filter(value=>typeof value==='string'&&/^[a-z_]+$/.test(value))||[];evidence.result=evidence.identityMatched?'AUTHENTICATED_READ_IDENTITY_MATCHED':'PROVIDER_IDENTITY_MISMATCH';}
  else if(!evidence.result)evidence.result=response.status===401?'PROVIDER_AUTHENTICATION_REJECTED':response.status===403?'PROVIDER_AUTHORIZATION_REJECTED':Array.isArray(payload?.errors)?'GRAPHQL_READ_REJECTED':'PROVIDER_READ_NOT_PROVEN';
 }catch(error){evidence.result=error?.providerStatus===401?'PROVIDER_AUTHENTICATION_REJECTED':error?.providerStatus===403?'PROVIDER_AUTHORIZATION_REJECTED':'READ_PROBE_FAILED';if(Number.isInteger(error?.providerStatus))evidence.httpStatus=error.providerStatus;evidence.error={name:/^[A-Za-z0-9_]+$/.test(error.name||'')?error.name:'Error',code:/^[A-Za-z0-9_]+$/.test(String(error.code||''))?error.code:undefined};}
 output.accounts.push(evidence);
}
await writeFile('tmp/mongo-reliability/configured-shopify-readonly-2026-10-04.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({readOnly:true,accountsChecked:output.accounts.length,results:output.accounts.map(account=>({accountReference:account.accountReference,result:account.result,httpStatus:account.httpStatus,authenticated:account.authenticated,identityMatched:account.identityMatched}))}));
