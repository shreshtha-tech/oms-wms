import assert from 'node:assert/strict';
import { randomBytes, scrypt as callback, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { sealCredential, openCredential } from '../inventory/credentials.js';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { authConfigured, verifyCredentials, issueSession, authenticateSession, revokeSession } from '../api/auth-session.js';

const url = new URL(process.env.INVENTORY_DATABASE_URL || '');
if (!['localhost','127.0.0.1','::1'].includes(url.hostname) || !/^\/codexqa_test_sessions_/.test(url.pathname)) throw new Error('Use the isolated session runner');
const db = inventoryPool();
process.env.INVENTORY_CREDENTIAL_KEY = randomBytes(32).toString('hex');
const username = 'session-fixture';
const password = randomBytes(24).toString('hex');
const salt = randomBytes(16).toString('hex');
const hash = `${salt}:${(await promisify(callback)(password,salt,64)).toString('hex')}`;
process.env.DMILLS_ADMIN_USER = username;
try {
  await migrateInventory();
  for (const invalid of ['', 'malformed', ':'.concat('a'.repeat(128)), `${hash}:extra`]) {
    process.env.DMILLS_ADMIN_PASSWORD_HASH = invalid;
    assert.equal(authConfigured(), false, 'Malformed credentials must not report configured');
    assert.equal(await verifyCredentials(username,password), false);
  }
  process.env.DMILLS_ADMIN_PASSWORD_HASH = hash;
  assert.equal(authConfigured(), true);
  assert.equal(await verifyCredentials(username,password), true);
  assert.equal(await verifyCredentials(username,'wrong-fixture-password'), false);
  assert.equal(await verifyCredentials('other-fixture',password), false);
  let header;
  const response = {setHeader(name,value) { assert.equal(name,'Set-Cookie'); header=value; }};
  await issueSession(response,username,true);
  assert.match(header,/; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure$/);
  const request = {headers:{cookie:header.split(';')[0]}};
  const token = request.headers.cookie.split('=')[1];
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const rows = (await db.query('SELECT * FROM ci_auth_session')).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].token_hash,tokenHash);
  assert.equal(JSON.stringify(rows).includes(token),false,'Raw bearer token must not persist');
  assert.deepEqual(await authenticateSession(request),{username});
  const freshModule = await import('../api/auth-session.js?session-reload');
  assert.deepEqual(await freshModule.authenticateSession(request),{username},'Session survives module reload');
  process.env.DMILLS_ADMIN_PASSWORD_HASH = `${salt}:${'0'.repeat(128)}`;
  assert.equal(await authenticateSession(request),null,'Credential rotation invalidates old session');
  process.env.DMILLS_ADMIN_PASSWORD_HASH = hash;
  process.env.DMILLS_ADMIN_USER = 'renamed-fixture';
  assert.equal(await authenticateSession(request),null);
  process.env.DMILLS_ADMIN_USER = username;
  await db.query("UPDATE ci_auth_session SET expires_at=now()-interval '1 second'");
  assert.equal(await authenticateSession(request),null);
  await issueSession(response,username);
  const second = {headers:{cookie:header.split(';')[0]}};
  assert.equal((await db.query('SELECT count(*) FROM ci_auth_session')).rows[0].count,'1','Issuing session removes expired rows');
  await revokeSession(second,response);
  assert.match(header,/Max-Age=0$/);
  assert.equal(await authenticateSession(second),null);
  assert.equal(await authenticateSession({headers:{cookie:'dmills_session=invalid'}}),null);
  assert.equal((await db.query('SELECT count(*) FROM ci_auth_session')).rows[0].count,'0');
  // Exercise the actual server mount order with fixture-only storage/configuration.
  const probe = createServer();
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port = probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const child = spawn(process.execPath,['server.js'],{env:{...process.env,INVENTORY_ALLOWED_TENANT_ID:'bridge-fixture',PORT:String(port),NODE_ENV:'test',DMILLS_REQUIRE_PERSISTENCE:'false',MONGODB_URI:'',DMILLS_ADMIN_USER:username,DMILLS_ADMIN_PASSWORD_HASH:hash},stdio:['ignore','pipe','pipe']});
  // Drain without exposing environment or bearer credentials through output.
  child.stdout.resume(); child.stderr.resume();
  const exited = new Promise(resolve=>child.once('exit',resolve));
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready=false;
    for(let attempt=0;attempt<100;attempt++) {
      if(child.exitCode!==null) throw new Error('Fixture server exited before readiness');
      try { ready=(await fetch(`${base}/api/auth/session`)).ok; } catch {}
      if(ready)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(ready,true,'Fixture HTTP server must start');
    const bridgeToken=randomBytes(32).toString('hex');
    const bridgeSecret=sealCredential({agentToken:bridgeToken});
    const bridge=(await db.query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,encrypted_credentials,credential_iv,credential_tag) VALUES('bridge-fixture','tally','replay-fixture',$1,$2,$3) RETURNING id",[bridgeSecret.encrypted,bridgeSecret.iv,bridgeSecret.tag])).rows[0];
    const exportXml=company=>`<ENVELOPE><COMPANY NAME="${company}"></COMPANY><VOUCHER><ID>${company}</ID></VOUCHER></ENVELOPE>`;
    const sendExport=(xml,token=bridgeToken)=>fetch(`${base}/api/inventory-sync/connections/agent/export`,{method:'POST',headers:{'Content-Type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({accountId:bridge.id,xml})});
    assert.equal((await sendExport(exportXml('FIRST'),'wrong-fixture')).status,401);
    assert.equal((await db.query("SELECT count(*) FROM ci_ingress WHERE tenant_id='bridge-fixture'")).rows[0].count,'0');
    await db.query("CREATE FUNCTION codexqa_fail_tally_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='tally_export' THEN RAISE EXCEPTION 'fixture tally diagnostic unavailable'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER codexqa_tally_diagnostic BEFORE INSERT ON ci_sync_attempt FOR EACH ROW EXECUTE FUNCTION codexqa_fail_tally_diagnostic()');
    try{
      assert.equal((await sendExport(exportXml('FIRST'))).status,200,'Committed bridge receipt cannot be reported as rejected because diagnostics failed');
      assert.equal((await sendExport(exportXml('FIRST'))).status,200,'Replay remains accepted during diagnostic outage');
      assert.equal((await db.query("SELECT count(*) FROM ci_outbox WHERE account_id=$1 AND task_type='tally_voucher_review'",[bridge.id])).rows[0].count,'1');
    }finally{await db.query('DROP TRIGGER codexqa_tally_diagnostic ON ci_sync_attempt');await db.query('DROP FUNCTION codexqa_fail_tally_diagnostic()');}
    assert.equal((await sendExport(exportXml('SECOND'))).status,200);
    const currentVerification=(await db.query('SELECT verification FROM ci_channel_account WHERE id=$1',[bridge.id])).rows[0].verification;
    assert.equal((await sendExport(exportXml('FIRST'))).status,200);
    assert.deepEqual((await db.query('SELECT verification FROM ci_channel_account WHERE id=$1',[bridge.id])).rows[0].verification,currentVerification,'Old exact export replay must not replace the latest bridge catalog');
    assert.equal((await db.query("SELECT count(*) FROM ci_outbox WHERE account_id=$1 AND task_type='tally_voucher_review' AND status='held'",[bridge.id])).rows[0].count,'2','Replay must not duplicate held voucher exports');
    assert.equal((await db.query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id='bridge-fixture'")).rows[0].count,'0','Bridge observations must not write physical inventory');
    console.log('PASS: Tally invalid-token rejection, old export replay preservation, held voucher deduplication and no physical-stock mutation.');
    const pairingCode=randomBytes(16).toString('hex');
    const pairingDigest=createHash('sha256').update(pairingCode).digest('hex');
    await db.query("INSERT INTO ci_agent_pairing(code_hash,tenant_id,account_id,expires_at) VALUES($1,'bridge-fixture',$2,now()+interval '10 minutes')",[pairingDigest,bridge.id]);
    const pair=code=>fetch(`${base}/api/inventory-sync/connections/agent/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const paired=await Promise.all([pair(pairingCode),pair(pairingCode)]);
    assert.deepEqual(paired.map(response=>response.status).sort(),[200,400],'Concurrent use of one pairing code must issue one token');
    const winner=await paired.find(response=>response.status===200).json();
    const pairedRow=(await db.query('SELECT * FROM ci_channel_account WHERE id=$1',[bridge.id])).rows[0];
    assert.equal(openCredential(pairedRow).agentToken,winner.token);
    assert.equal((await sendExport(exportXml('THIRD'),bridgeToken)).status,401,'Pairing rotation revokes previous agent token');
    assert.equal((await sendExport(exportXml('THIRD'),winner.token)).status,200);
    const failedCode=randomBytes(16).toString('hex'), failedDigest=createHash('sha256').update(failedCode).digest('hex');
    await db.query("INSERT INTO ci_agent_pairing(code_hash,tenant_id,account_id,expires_at) VALUES($1,'bridge-fixture',$2,now()+interval '10 minutes')",[failedDigest,bridge.id]);
    const beforeFailedPair=(await db.query('SELECT encrypted_credentials,credential_iv,credential_tag FROM ci_channel_account WHERE id=$1',[bridge.id])).rows[0];
    await db.query("CREATE FUNCTION codexqa_fail_pairing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture pairing consumption failure'; END $$");
    await db.query('CREATE TRIGGER codexqa_pairing_failure BEFORE UPDATE ON ci_agent_pairing FOR EACH ROW EXECUTE FUNCTION codexqa_fail_pairing()');
    try {
      assert.equal((await pair(failedCode)).status,400);
      assert.deepEqual((await db.query('SELECT encrypted_credentials,credential_iv,credential_tag FROM ci_channel_account WHERE id=$1',[bridge.id])).rows[0],beforeFailedPair,'Failed code consumption rolls back credential rotation');
      assert.equal((await db.query('SELECT consumed_at FROM ci_agent_pairing WHERE code_hash=$1',[failedDigest])).rows[0].consumed_at,null);
    } finally { await db.query('DROP TRIGGER codexqa_pairing_failure ON ci_agent_pairing'); await db.query('DROP FUNCTION codexqa_fail_pairing()'); }
    assert.equal((await pair(failedCode)).status,200,'Failed transaction preserves code for retry');
    console.log('PASS: concurrent Tally pairing issues one token, revokes prior token, and rolls back credentials/code on injected consumption failure.');
    const state=randomBytes(32).toString('hex'), browser=randomBytes(32).toString('hex');
    const digest=value=>createHash('sha256').update(value).digest('hex');
    const sealed=sealCredential({fields:{sellerId:'fixture-seller'},callback:'https://fixture.invalid/callback'});
    await db.query("INSERT INTO ci_connection_oauth(state_hash,tenant_id,platform,browser_hash,encrypted_credentials,credential_iv,credential_tag,expires_at) VALUES($1,'oauth-fixture','amazon_fba',$2,$3,$4,$5,now()+interval '10 minutes')",[digest(state),digest(browser),sealed.encrypted,sealed.iv,sealed.tag]);
    const callbackBase=`${base}/api/inventory-sync/connections/oauth/amazon_fba/callback?state=${state}`;
    const oauthCookie=`dmills_oauth_${state.slice(0,12)}=${browser}`;
    for(const [suffix,headers] of [['&code=fixture-code&selling_partner_id=fixture-seller',{}],['&selling_partner_id=fixture-seller',{cookie:oauthCookie}],['&code=fixture-code&selling_partner_id=other-seller',{cookie:oauthCookie}]]) {
      assert.equal((await fetch(callbackBase+suffix,{headers})).status,400);
      assert.equal((await db.query('SELECT consumed_at FROM ci_connection_oauth WHERE state_hash=$1',[digest(state)])).rows[0].consumed_at,null,'Invalid callback must preserve unused OAuth state');
    }
    for(const route of ['/api/inventory','/api/skus','/api/reports','/api/inventory-sync/accounts','/api/unknown-fixture']) {
      for(const method of ['GET','POST','PUT','DELETE']) {
        assert.equal((await fetch(base+route,{method})).status,401,`Unauthenticated ${method} ${route}`);
      }
    }
    const login = await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(login.status,200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await fetch(`${base}/api/auth/session`,{headers:{cookie}})).json()).user,{username});
    const authorized = await fetch(`${base}/api/unknown-fixture`,{headers:{cookie}});
    assert.equal(authorized.status,404,'Valid session passes middleware to missing-route handler');
    assert.equal((await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{cookie}})).status,200);
    assert.equal((await fetch(`${base}/api/inventory`,{headers:{cookie}})).status,401,'HTTP logout revokes server-side session');
    assert.equal((await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'incorrect-fixture'})})).status,401);
    console.log('PASS: actual HTTP server denies 20 protected method/route combinations; fixture login, session lookup and logout revocation pass.');
  } finally {
    child.kill('SIGTERM'); await exited;
  }
  console.log('PASS: malformed configuration, credential checks, hashed persistence, reload, rotation, rename, expiry, cleanup and logout. Fixture secrets withheld.');
} finally { await db.end(); }
