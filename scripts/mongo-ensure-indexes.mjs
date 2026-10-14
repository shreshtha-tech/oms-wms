// PROPOSAL: additive indexes only, never invoked by application startup.
import '../env.js';
import { MongoClient } from 'mongodb';
import { argumentsOf, requireSelectedDatabase, isMain, safeFailure } from './mongo-tooling.mjs';
import { mongoReceiptClaimIndexes } from '../inventory/receipt-claim-query.js';
export const proposedIndexes = [
  { collection: 'skus', keys: { sku_code: 1 }, options: { name: 'uq_master_sku_code', unique: true, partialFilterExpression: { sku_code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
  { collection: 'vendors', keys: { vendor_code: 1 }, options: { name: 'vendors_code_unique', unique: true } },
  { collection: 'purchase_orders', keys: { po_no: 1 }, options: { name: 'uq_purchase_order_number', unique: true, partialFilterExpression: { po_no: { $type: 'string' } } } },
  { collection: 'grn', keys: { central_request_id: 1 }, options: { name: 'uq_grn_central_request_id', unique: true, partialFilterExpression: { central_request_id: { $type: 'string', $gt: '' } } } },
  { collection: 'generic_records', keys: { module: 1, code: 1 }, options: { name: 'uq_sku_group_code', unique: true, partialFilterExpression: { module: 'sku-group', code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
  { collection: 'generic_records', keys: { module: 1, company_location: 1, sku_code: 1 }, options: { name: 'uq_sku_company_link', unique: true, partialFilterExpression: { module: 'sku-company-link', company_location: { $type: 'string' }, sku_code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } } },
];
export const mongoZonePickerIndexes = [
  { collection: 'generic_records', keys: { id: 1 }, options: { name: 'uq_generic_numeric_id', unique: true } },
  { collection: 'generic_records', keys: { code: 1, module: 1 }, options: { name: 'idx_wms_picker_code_module', partialFilterExpression: { module: 'user-enquiry' } } },
];
export async function main(args = process.argv.slice(2), { env = process.env, Client = MongoClient, output = console.log } = {}) {
  const options = argumentsOf(args); const config = requireSelectedDatabase(options, env, true);
  if(options['--scope']!==undefined&&!['receipt-claims','zone-pickers'].includes(options['--scope']))throw new Error('Unsupported index scope');
  const indexes=options['--scope']==='receipt-claims'
   ? mongoReceiptClaimIndexes.map(definition=>({collection:'_domain_outbox',...definition}))
   : options['--scope']==='zone-pickers' ? mongoZonePickerIndexes : proposedIndexes;
  const client = new Client(env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect(); const db = client.db(config.selectedDatabase);
    // Mongo createIndex is additive and idempotent for identical definitions.
    // Conflicting definitions or duplicate records fail; nothing is dropped or rewritten.
    for (const index of indexes) await db.collection(index.collection).createIndex(index.keys, index.options);
    output(JSON.stringify({ database: config.selectedDatabase, scope: options['--scope'] || 'legacy', proposedIndexes: indexes.length }));
  } finally { await client.close(); }
}
if (isMain(import.meta.url)) main().catch(safeFailure);
