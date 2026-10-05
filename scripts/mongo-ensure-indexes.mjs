// PROPOSAL: additive indexes only, never invoked by application startup.
import '../env.js';
import { MongoClient } from 'mongodb';
import { argumentsOf, requireSelectedDatabase, isMain, safeFailure } from './mongo-tooling.mjs';
export const proposedIndexes = [
  { collection: 'skus', keys: { sku_code: 1 }, options: { name: 'uq_master_sku_code', unique: true, partialFilterExpression: { sku_code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
  { collection: 'vendors', keys: { vendor_code: 1 }, options: { name: 'vendors_code_unique', unique: true } },
  { collection: 'purchase_orders', keys: { po_no: 1 }, options: { name: 'uq_purchase_order_number', unique: true, partialFilterExpression: { po_no: { $type: 'string' } } } },
  { collection: 'grn', keys: { central_request_id: 1 }, options: { name: 'uq_grn_central_request_id', unique: true, partialFilterExpression: { central_request_id: { $type: 'string', $gt: '' } } } },
  { collection: 'generic_records', keys: { module: 1, code: 1 }, options: { name: 'uq_sku_group_code', unique: true, partialFilterExpression: { module: 'sku-group', code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
  { collection: 'generic_records', keys: { module: 1, company_location: 1, sku_code: 1 }, options: { name: 'uq_sku_company_link', unique: true, partialFilterExpression: { module: 'sku-company-link', company_location: { $type: 'string' }, sku_code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
];
export async function main(args = process.argv.slice(2)) {
  const options = argumentsOf(args); const config = requireSelectedDatabase(options, process.env, true);
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect(); const db = client.db(config.selectedDatabase);
    // Mongo createIndex is additive and idempotent for identical definitions.
    // Conflicting definitions or duplicate records fail; nothing is dropped or rewritten.
    for (const index of proposedIndexes) await db.collection(index.collection).createIndex(index.keys, index.options);
    console.log(JSON.stringify({ database: config.selectedDatabase, proposedIndexes: proposedIndexes.length }));
  } finally { await client.close(); }
}
if (isMain(import.meta.url)) main().catch(safeFailure);
