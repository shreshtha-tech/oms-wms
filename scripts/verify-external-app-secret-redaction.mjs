import assert from 'node:assert/strict';

// Force the app data layer to its explicitly unconfigured in-memory fixture.
process.env.MONGODB_URI='';
process.env.DMILLS_REQUIRE_PERSISTENCE='';
process.env.INVENTORY_CREDENTIAL_KEY='b'.repeat(64);
const {insert,findOne,waitForDataReady}=await import('../api/mongo.js');
const {default:externalApps}=await import('../api/external-apps.js');
const {default:externalAppConnection}=await import('../api/external-app-connections.js');
const {openCredential}=await import('../inventory/credentials.js');
await waitForDataReady();

function response(){return {statusCode:200,body:null,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){return this;}};}
async function invoke(handler,method,path,body={},query={}){const res=response();await handler({method,path,body,query},res);return res;}

const suffix=Date.now(),description=`secret-redaction-${suffix}`;
const stored=await insert('external_apps',{ext_app_type:'SME',ext_app_id:'43',ext_app_desc:description,client_id:'0',status:'Active',config:{username:'local-user',password:'db-password-secret',apiToken:'db-access-token',credential1:'sfmc-subdomain',credential3:'sfmc-client-secret',nested:{clientSecret:'nested-secret'}}});

const list=await invoke(externalApps,'GET','/api/external-apps');
assert.equal(list.statusCode,200);
const listed=list.body.rows.find(row=>row.id===stored.id);
assert.ok(listed);
assert.equal(listed.config.username,'local-user','Nonsecret settings remain available');
for(const key of ['password','apiToken','credential1','credential3'])assert.equal(listed.config[key],'[stored]',`${key} is masked`);
assert.equal(listed.config.nested.clientSecret,'[stored]','Nested secrets are masked');
assert.ok(!JSON.stringify(list.body).includes('db-password-secret'));
assert.ok(!JSON.stringify(list.body).includes('db-access-token'));
assert.ok(!JSON.stringify(list.body).includes('sfmc-client-secret'));

const search=await invoke(externalApps,'POST','/api/jsonExternalAppsSearch',{REQ_SEARCH_FLAG:true,rows:20,page:1,extapptype:'SME',extid:'43',desc:description,clientId:'0'});
assert.equal(search.statusCode,200);
assert.equal(search.body.rows[0].config.credential3,'[stored]','The enquiry API must redact credentials too');
assert.ok(!JSON.stringify(search.body).includes('sfmc-client-secret'));

const save=await invoke(externalApps,'POST','/api/saveExternalAppsData',{extappType:'SME',extappid:'43',extappdesc1:description,status:'1',clientId:'0',extsubid:String(stored.id),credential1:'[stored]',credential3:'[stored]',password:'[stored]',username:'changed-user'});
assert.equal(save.statusCode,200);
assert.ok(!JSON.stringify(save.body).includes('sfmc-client-secret'),'Save response must not echo stored credentials');
const afterSave=await findOne('external_apps',{id:stored.id});
assert.equal(afterSave.config.username,'changed-user','Ordinary settings can still be updated');
assert.equal(afterSave.config.credential1,undefined,'Credential values are removed from plaintext config');
assert.equal(afterSave.config.password,undefined,'Passwords are removed from plaintext config');
const encryptedConfig=openCredential({encrypted_credentials:Buffer.from(afterSave.secret_config_encrypted,'base64'),credential_iv:Buffer.from(afterSave.secret_config_iv,'base64'),credential_tag:Buffer.from(afterSave.secret_config_tag,'base64')});
assert.equal(encryptedConfig.credential1,'sfmc-subdomain','Masked credential remains unchanged on edit');
assert.equal(encryptedConfig.credential3,'sfmc-client-secret','Masked client secret remains unchanged on edit');
assert.equal(encryptedConfig.password,'db-password-secret','Masked password remains unchanged on edit');
assert.equal(encryptedConfig.nested.clientSecret,'nested-secret','Nested secret remains unchanged on edit');
for(const key of ['db-password-secret','db-access-token','sfmc-client-secret','nested-secret'])assert.ok(!JSON.stringify(afterSave).includes(key),'Saved Mongo document stores no plaintext credential value');
const encryptedList=await invoke(externalApps,'GET','/api/external-apps');
const encryptedView=encryptedList.body.rows.find(row=>row.id===stored.id);
assert.equal(encryptedView.config.credential3,'[stored]','Encrypted credentials remain masked in later list reads');
assert.equal(encryptedView.config.nested.clientSecret,'[stored]','Nested encrypted credentials remain masked in later reads');
assert.ok(!JSON.stringify(encryptedList.body).includes('sfmc-client-secret'));

const configuredKey=process.env.INVENTORY_CREDENTIAL_KEY;
delete process.env.INVENTORY_CREDENTIAL_KEY;
try{
  const keylessList=await invoke(externalApps,'GET','/api/external-apps');
  assert.equal(keylessList.body.rows.find(row=>row.id===stored.id).config.credential3,'[stored]','A missing key does not reveal encrypted data');
  const rejected=await invoke(externalApps,'POST','/api/saveExternalAppsData',{extappType:'SME',extappid:'43',extappdesc1:`no-key-${suffix}`,status:'1',clientId:'0',credential3:'new-client-secret'});
  assert.equal(rejected.statusCode,503,'Secret-bearing saves must fail closed without the encryption key');
  assert.ok(!JSON.stringify(rejected.body).includes('new-client-secret'));
  assert.equal(await findOne('external_apps',{ext_app_desc:`no-key-${suffix}`}),null,'A secret-bearing record must not be persisted without the key');
}finally{process.env.INVENTORY_CREDENTIAL_KEY=configuredKey;}

const originalFetch=globalThis.fetch;
let upstreamRequest;
try{
  globalThis.fetch=async(url,options)=>{upstreamRequest={url:String(url),body:String(options.body),redirect:options.redirect};return {ok:true,status:200,json:async()=>({access_token:'fixture-provider-bearer-token'})};};
  const tokenTest=await invoke(externalAppConnection,'POST','/api/testSMSConnection',{extAppID:'43',subDomain:'fixture-sfmc',clientID:'fixture-client-id',clientSecret:'fixture-client-secret'});
  assert.equal(tokenTest.statusCode,200);
  assert.deepEqual(tokenTest.body,{jsonMessage:null,connected:true});
  assert.ok(!JSON.stringify(tokenTest.body).includes('fixture-provider-bearer-token'));
  assert.ok(!('authTokenSFMC' in tokenTest.body));
  assert.match(upstreamRequest.url,/\.auth\.marketingcloudapis\.com\/v2\/token$/);
  assert.equal(upstreamRequest.redirect,'error','Provider redirects must not make the server request a second destination');
}finally{globalThis.fetch=originalFetch;}

console.log('PASS External Apps secret handling: list/search/save redaction, masked-value preservation, encrypted storage, missing-key rejection, and no provider bearer token returned');
