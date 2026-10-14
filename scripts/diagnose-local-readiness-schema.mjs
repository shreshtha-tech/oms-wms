// Read-only diagnosis for the application's explicitly configured loopback DB.
// Never prints a connection string, credentials, or business records.
import '../env.js';
import pg from 'pg';

const raw = process.env.INVENTORY_DATABASE_URL;
if (!raw) throw new Error('INVENTORY_DATABASE_URL is not configured');
const target = new URL(raw);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
  throw new Error('This diagnostic only accepts a loopback PostgreSQL target');
}

const tables = ['ci_auth_session', 'ci_login_rate_limit', 'ci_outbox', 'ci_channel_stock',
  'ci_channel_mapping', 'ci_channel_account', 'ci_master_sku', 'ci_event_receipt', 'ci_domain_outbox'];
const outboxColumns = ['remote_target_quantity', 'remote_attempt_started_at', 'publication_state',
  'provider_platform', 'internal_sku_id', 'internal_location_id', 'external_sku',
  'provider_listing_id', 'provider_location_id', 'pack_size', 'source_event_id',
  'remote_request_id', 'provider_response_reference', 'acknowledged_at',
  'readback_quantity', 'readback_at', 'reconciliation_result'];
const stockColumns = ['readback_quantity', 'readback_at'];
const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 3000,
  statement_timeout: 5000, ssl: process.env.INVENTORY_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined });

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const tableRows = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2)', ['public', tables]);
  const outboxRows = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=ANY($3)', ['public', 'ci_outbox', outboxColumns]);
  const stockRows = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=ANY($3)', ['public', 'ci_channel_stock', stockColumns]);
  const present = (rows, key) => new Set(rows.map(row => row[key]));
  const foundTables = present(tableRows.rows, 'table_name');
  const foundOutbox = present(outboxRows.rows, 'column_name');
  const foundStock = present(stockRows.rows, 'column_name');
  console.log(JSON.stringify({ result: 'READ_ONLY_SCHEMA', missingTables: tables.filter(name => !foundTables.has(name)),
    missingOutboxColumns: outboxColumns.filter(name => !foundOutbox.has(name)),
    missingStockColumns: stockColumns.filter(name => !foundStock.has(name)) }));
} catch (error) {
  console.log(JSON.stringify({ result: 'SCHEMA_QUERY_FAILED', code: String(error?.code || error?.name || 'UNKNOWN').slice(0, 60) }));
  process.exitCode = 2;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
