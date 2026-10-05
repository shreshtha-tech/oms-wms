import { receiveCentralInboundStock } from '../inventory/wms-operations.js';

if (!/^codexqa_/.test(process.env.MONGODB_DB || '') || !/codexqa_/.test(process.env.INVENTORY_DATABASE_URL || '')
  || !process.env.INVENTORY_ALLOWED_TENANT_ID || typeof process.send !== 'function') {
  throw new Error('This child must run under the disposable dual-store verifier.');
}

await receiveCentralInboundStock({
  requestId: 'dual-kill', inboundNo: 'INB-KILL', poNo: 'PO-KILL', locationCode: 'DUAL-WH',
  lines: [{ skuCode: 'DUAL-SKU', quantity: 2 }], source: 'wms_inbound_create_edit',
  finalize: async () => {
    // The service calls finalize only after PostgreSQL COMMIT. Keep the child
    // alive here until the parent forcibly kills it; Mongo is still pending.
    await new Promise(resolve => process.send('pg-committed', resolve));
    await new Promise(() => {});
  },
});
