// Read-only, loopback-only preflight for data-dependent inventory migrations.
// Counts are operational evidence; no identifiers, credentials, or rows print.
import '../env.js';
import pg from 'pg';

const raw = process.env.INVENTORY_DATABASE_URL;
if (!raw) throw new Error('INVENTORY_DATABASE_URL is not configured');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
  throw new Error('This preflight only accepts a loopback PostgreSQL target');
}
const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 3000,
  statement_timeout: 5000, ssl: process.env.INVENTORY_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const alert = await client.query(`SELECT count(*)::int AS rows,
    count(DISTINCT (tenant_id,order_id,recipient_id))::int AS unique_identities
    FROM ci_order_alert`);
  const authority = await client.query(`SELECT count(*)::int AS accounts,
    count(*) FILTER (WHERE platform IN ('woocommerce','amazon')
      AND settings->>'providerAuthoritative' IS DISTINCT FROM 'true')::int AS would_change
    FROM ci_channel_account`);
  const authorityByPlatform = await client.query(`SELECT platform,
    count(*)::int AS accounts,
    count(*) FILTER (WHERE platform IN ('woocommerce','amazon')
      AND settings->>'providerAuthoritative' IS DISTINCT FROM 'true')::int AS would_change
    FROM ci_channel_account GROUP BY platform ORDER BY platform`);
  const orderStatus = await client.query(`SELECT count(*) FILTER
    (WHERE work_status NOT IN ('new','accepted','packed','partially_shipped','dispatched','cancelled','returned'))::int AS invalid
    FROM ci_unified_order`);
  const invalidEventIds = await client.query(`SELECT count(*)::int AS duplicate_identities FROM (
    SELECT tenant_id,id FROM ci_inventory_event GROUP BY tenant_id,id HAVING count(*)>1
    ) duplicate`);
  const size = await client.query('SELECT pg_database_size(current_database())::bigint AS bytes');
  console.log(JSON.stringify({ result: 'READ_ONLY_PREFLIGHT', databaseBytes: Number(size.rows[0].bytes), migration021: {
    historicalAlertRows: alert.rows[0].rows, uniqueAlertIdentities: alert.rows[0].unique_identities,
    invalidExistingOrderStatuses: orderStatus.rows[0].invalid }, migration022: {
    existingChannelAccounts: authority.rows[0].accounts, wouldSetProviderAuthoritative: authority.rows[0].would_change,
    byPlatform: authorityByPlatform.rows },
  migration023: { duplicateEventTenantIds: invalidEventIds.rows[0].duplicate_identities } }));
} catch (error) {
  console.log(JSON.stringify({ result: 'PREFLIGHT_FAILED', code: String(error?.code || error?.name || 'UNKNOWN').slice(0, 60) }));
  process.exitCode = 2;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
