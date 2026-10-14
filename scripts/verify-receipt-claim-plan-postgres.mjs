import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { receiptResultClaimSql, receiptExpiredResultClaimSql } from '../inventory/receipt-claim-query.js';

function descendants(node) { return [node,...(node.Plans||[]).flatMap(descendants)]; }
export async function verifyReceiptClaimPlanPostgres(config) {
 const client=new pg.Client(config);
 await client.connect();
 try {
  await client.query('SET statement_timeout=15000');
  await client.query(`CREATE TEMP TABLE ci_domain_outbox (
   event_id uuid PRIMARY KEY,tenant_id text NOT NULL,envelope jsonb NOT NULL,status text NOT NULL,
   attempts integer NOT NULL,available_at timestamptz NOT NULL,created_at timestamptz NOT NULL,
   claim_token uuid,lease_until timestamptz)`);
  await client.query(`INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at)
   SELECT gen_random_uuid(),'plan-fixture','{}'::jsonb,'done',0,now(),now()+g*interval '1 millisecond'
   FROM generate_series(1,20000) AS g`);
  const eventId=randomUUID();
  await client.query(`INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at)
   VALUES($1,'plan-fixture','{}','pending',0,now(),now()+interval '21 seconds')`,[eventId]);
  await client.query('ANALYZE ci_domain_outbox');
  async function measure(sql,selectedId,resetStatus) {
   const response=await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,['plan-fixture',randomUUID()]);
   const plan=response.rows[0]['QUERY PLAN'][0];
   const row=await client.query('SELECT status,attempts FROM ci_domain_outbox WHERE event_id=$1',[selectedId]);
   assert.deepEqual(row.rows,[{status:'processing',attempts:1}]);
   await client.query('UPDATE ci_domain_outbox SET status=$2,attempts=0,claim_token=NULL,lease_until=CASE WHEN $2=\'processing\' THEN to_timestamp(0) ELSE NULL END WHERE event_id=$1',[selectedId,resetStatus]);
   const scans=descendants(plan.Plan).filter(node=>node['Relation Name']==='ci_domain_outbox');
   return { executionMs:plan['Execution Time'],scans:scans.map(node=>({type:node['Node Type'],index:node['Index Name']||null,rows:node['Actual Rows'],removed:node['Rows Removed by Filter']||0,sharedReads:node['Shared Read Blocks']||0,localHits:node['Local Hit Blocks']||0})) };
  }
  const withoutIndex=await measure(receiptResultClaimSql,eventId,'pending');
  await client.query(`CREATE INDEX receipt_claim_fixture_idx ON ci_domain_outbox (tenant_id,created_at,event_id)
   WHERE status IN ('pending','retry','processing') AND attempts<8`);
  await client.query('ANALYZE ci_domain_outbox');
  const withIndex=await measure(receiptResultClaimSql,eventId,'pending');
  await client.query(`INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at)
   SELECT gen_random_uuid(),'plan-fixture','{}'::jsonb,'pending',0,now()-interval '1 minute',now()+g*interval '1 microsecond'
   FROM generate_series(1,1000) g`);
  const expiredId=randomUUID();
  await client.query(`INSERT INTO ci_domain_outbox(event_id,tenant_id,envelope,status,attempts,available_at,created_at,lease_until)
   VALUES($1,'plan-fixture','{}','processing',0,now()-interval '1 minute',now()+interval '22 seconds',to_timestamp(0))`,[expiredId]);
  await client.query('ANALYZE ci_domain_outbox');
  const expiredWithoutIndex=await measure(receiptExpiredResultClaimSql,expiredId,'processing');
  await client.query(`CREATE INDEX receipt_expired_fixture_idx ON ci_domain_outbox (tenant_id,lease_until,event_id)
   WHERE status='processing' AND attempts<8`);
  await client.query('ANALYZE ci_domain_outbox');
  const expiredWithIndex=await measure(receiptExpiredResultClaimSql,expiredId,'processing');
  assert.ok(withoutIndex.scans.some(node=>node.type==='Seq Scan'&&node.removed>=20000),'Backlog fixture must expose the unindexed full scan');
  assert.ok(withIndex.scans.some(node=>node.index==='receipt_claim_fixture_idx'),'Exact runtime claim must use the candidate partial index');
  assert.ok(expiredWithIndex.scans.some(node=>node.index==='receipt_expired_fixture_idx'),'Expired claim must use its due-time index');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM ci_domain_outbox WHERE status='done'")).rows[0].n,20000);
  return {rows:21002,withoutIndex,withIndex,expiredWithoutIndex,expiredWithIndex};
 } finally { await client.end(); }
}
