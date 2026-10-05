import '../env.js';
import pg from 'pg';

const connectionString = process.env.INVENTORY_DATABASE_URL;
if (!connectionString) {
  console.error('Inventory audit: INVENTORY_DATABASE_URL is unset.');
  process.exit(2);
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const identity = (await client.query('SELECT current_database() AS database, current_user AS role')).rows[0];
  const privilege = (await client.query('SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user')).rows[0];
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ci_%' ORDER BY tablename")).rows.map((row) => row.tablename);
  const counts = {};
  for (const table of ['ci_master_sku', 'ci_location', 'ci_inventory_balance', 'ci_inventory_event', 'ci_channel_account', 'ci_channel_mapping', 'ci_reservation']) {
    if (tables.includes(table)) counts[table] = Number((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ connected: true, database: identity.database, role: identity.role, canCreateTestDatabase: privilege?.rolcreatedb || false, centralTables: tables.length, counts }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('Inventory audit failed:', error.code || error.name || 'UNKNOWN_ERROR');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
