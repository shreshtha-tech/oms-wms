import { createPostgresConnection, postgresUnavailable } from '../reliability/postgres-connection.js';
import { readFile } from 'node:fs/promises';
import { prepareMigrationHistory, recordMigrationHistory } from './migration-history.js';
import { runPostgresTransaction, releasePostgresClient } from '../reliability/postgres-transaction.js';

let pool;
let manager;
export function inventoryDatabaseStatus() { return manager?.status() || { database: 'postgresql', state: 'UNAVAILABLE' }; }
export function inventoryPool() {
  if (!process.env.INVENTORY_DATABASE_URL) throw postgresUnavailable();
  if (!pool) { manager = createPostgresConnection({ connectionString: process.env.INVENTORY_DATABASE_URL, ssl: process.env.INVENTORY_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined }); pool = manager.pool; }
  return pool;
}
export async function transaction(fn) {
  return runPostgresTransaction(inventoryPool(), fn);
}
export async function migrateInventory() {
  const client=await inventoryPool().connect();
  let locked=false,discard=false;
  try{
  // Explicit migration CLI controls the longer DDL deadline.
  await client.query('SET statement_timeout = 120000');
  // One session owns the full migration sequence across concurrent startups.
  // Session loss releases this lock; each SQL file retains its own transaction.
  await client.query("SELECT pg_advisory_lock(hashtextextended('ci-schema-migrations',0))");
  locked=true;
  const migrations=[];
  for(const name of ['001_central_inventory.sql','002_order_line_state.sql','003_stock_alerts.sql','004_catalog_workbook.sql','005_inventory_imports.sql','006_seller_connections.sql','007_unified_orders.sql','008_whatsapp_delivery.sql','009_return_receipts.sql','010_service_heartbeat.sql','011_live_inventory_updates.sql','012_live_order_revisions.sql','013_persistent_sessions.sql','014_sales_programs.sql','015_immediate_order_whatsapp.sql','016_whatsapp_recipient_verification.sql','017_order_alert_teams.sql','018_alert_admin_actions.sql','019_reliability_login.sql','020_domain_event_receipts.sql','021_alert_once_and_partial_review.sql','022_provider_dispatch_authority.sql','023_controlled_opening_stock.sql','024_publication_uncertainty.sql','025_stock_publication_evidence.sql','026_receipt_bridge_claims.sql','027_receipt_result_claim_index.sql','028_receipt_expired_claim_index.sql','029_scope_provider_authority_cutover.sql','030_partial_reservations.sql']){
    const sql=await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');
    migrations.push({name,sql});
  }
  const manifest=await prepareMigrationHistory(client,migrations);
  for(const {sql} of manifest)await client.query(sql);
  const receiptClaimIndexes=await client.query("SELECT c.relname,i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('ci_domain_outbox_claim_active_idx','ci_domain_outbox_claim_expired_idx')");
  if(receiptClaimIndexes.rows.length!==2||receiptClaimIndexes.rows.some(row=>row.indisvalid!==true))throw Object.assign(new Error('Receipt claim indexes are missing or invalid; migration repair is required'),{code:'RECEIPT_CLAIM_INDEX_INVALID'});
  await recordMigrationHistory(client,manifest);
  }catch(error){
    try{await client.query('ROLLBACK');}catch{discard=true;}
    throw error;
  }finally{
    if(locked){try{await client.query("SELECT pg_advisory_unlock(hashtextextended('ci-schema-migrations',0))");}catch{discard=true;}}
    try { await client.query('RESET statement_timeout'); } catch { discard = true; }
    releasePostgresClient(client,discard);
  }
}
