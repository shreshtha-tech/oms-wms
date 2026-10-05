import '../env.js';
import pg from 'pg';
import { createHash } from 'node:crypto';
const client=new pg.Client({connectionString:process.env.INVENTORY_DATABASE_URL,connectionTimeoutMillis:8000,statement_timeout:10000});
const alias=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12);
const tables=['ci_master_sku','ci_location','ci_inventory_balance','ci_inventory_event','ci_reservation','ci_channel_account','ci_channel_mapping','ci_outbox'];
try{
 await client.connect();await client.query('BEGIN READ ONLY');
 const result={at:new Date().toISOString(),readOnly:true,postgresReachable:true,tenantConfigured:Boolean(process.env.INVENTORY_ALLOWED_TENANT_ID),counts:{},configuredTenantCounts:{},accounts:[]};
 for(const table of tables){
  result.counts[table]=Number((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  if(process.env.INVENTORY_ALLOWED_TENANT_ID)result.configuredTenantCounts[table]=Number((await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id=$1`,[process.env.INVENTORY_ALLOWED_TENANT_ID])).rows[0].count);
 }
 const rows=(await client.query('SELECT id,tenant_id,platform,status,connection_state,verified_at,encrypted_credentials IS NOT NULL AS credentialStored FROM ci_channel_account ORDER BY platform,id')).rows;
 result.accounts=rows.map(row=>({accountReference:alias(row.id),tenantReference:alias(row.tenant_id),matchesConfiguredTenant:row.tenant_id===process.env.INVENTORY_ALLOWED_TENANT_ID,provider:row.platform,storedStatus:row.status,storedConnectionState:row.connection_state,storedVerificationAt:row.verified_at,credentialStored:row.credentialstored,liveAuthenticationProvenThisRun:false,liveAuthorizationProvenThisRun:false}));
 await client.query('ROLLBACK');console.log(JSON.stringify(result,null,2));
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({readOnly:true,postgresReachable:false,code:error.code||error.name}));process.exitCode=1;}
finally{await client.end();}
