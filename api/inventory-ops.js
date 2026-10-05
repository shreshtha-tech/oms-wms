import { sendDatabaseUnavailable, find, insert, cors } from './mongo.js';
import { activeLocations } from './catalogs.js';
import { adjustCentralWmsStock, listCentralWmsStock, transferCentralWmsStock } from '../inventory/wms-operations.js';

const collections = { moves: 'inventory_moves', history: 'inventory_moves', scan: 'inventory_moves', intercompany: 'inventory_moves', lottables: 'inventory_lottables', 'bulk-lottables': 'inventory_lottables', adjustments: 'stock_adjustments', gatepass: 'outbound_gate_passes', 'outbound-gate-pass': 'outbound_gate_passes', memo: 'outbound_memos', 'outbound-memo': 'outbound_memos', transactions: 'sku_transactions', 'sku-transaction-history': 'sku_transactions', lots: 'sku_lot_transfers', 'sku-lot-transfer': 'sku_lot_transfers' };
const text = (v) => String(v ?? '').trim();
const today = () => new Date().toISOString();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if(!['GET','POST','PUT'].includes(req.method)){
    res.setHeader('Allow','GET, POST, PUT, OPTIONS');
    return res.status(405).json({error:'Method not allowed.'});
  }
  try {
    const entity = text(req.query.entity || req.body?.entity) || 'view';
    if (req.method === 'GET') return res.status(200).json(entity === 'view' ? await listCentralWmsStock() : await find(collections[entity] || entity, {}, { sort: { id: -1 } }));
    const body = req.body || {};
    const transferOperation = ({ 'inv-move': 'moves', 'inv-move-scan': 'scan', 'intercompany-move': 'intercompany' })[entity] || entity;
    if (['moves', 'scan', 'intercompany'].includes(transferOperation)) {
      if(!['number','string'].includes(typeof body.quantity)||(typeof body.quantity==='string'&&!body.quantity.trim()))return res.status(400).json({error:'A numeric whole stock quantity is required.'});
      const qty = Number(body.quantity);
      if (!text(body.sku_code) || !text(body.from_warehouse) || !text(body.to_warehouse) || !Number.isSafeInteger(qty) || qty <= 0) return res.status(400).json({ error: 'SKU, source, destination and a positive whole quantity are required.' });
      const requestId = text(body.requestId);
      if (!requestId) return res.status(400).json({ error: 'Request ID is required for a stock move.' });
      const configuredLocations = await activeLocations();
      const sourceLocation = configuredLocations.find(location => location.name === text(body.from_warehouse) || location.code === text(body.from_warehouse));
      const targetLocation = configuredLocations.find(location => location.name === text(body.to_warehouse) || location.code === text(body.to_warehouse));
      if (!sourceLocation || !targetLocation) return res.status(400).json({ error: 'Select configured active source and destination locations.' });
      if (sourceLocation.code === targetLocation.code) return res.status(400).json({ error: 'Source and destination locations must be different.' });
      const result = await transferCentralWmsStock({ skuCode: body.sku_code, fromCode: sourceLocation.code,
        toCode: targetLocation.code, quantity: qty, requestId, operation: transferOperation, reason: text(body.reason || body.reference) });
      return res.status(result.duplicate ? 200 : 201).json({ ...result, status: 'Completed' });
    }
    if (entity === 'adjustments') {
      const result = await adjustCentralWmsStock({ masterSkuId: body.masterSkuId, locationId: body.locationId,
        quantity: body.quantity, reason: body.reason, requestId: body.requestId });
      return res.status(result.duplicate ? 200 : 201).json(result);
    }
    if (!collections[entity]) return res.status(400).json({ error: 'Unknown inventory operation.' });
    if (!text(body.sku_code) && !['gatepass', 'memo'].includes(entity)) return res.status(400).json({ error: 'SKU is required.' });
    return res.status(201).json(await insert(collections[entity], { ...body, entity, status: body.status || 'Pending', created_at: today() }));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; res.status(error.statusCode || error.status || (error.code || /database|connection/i.test(error.message || '') ? 503 : 500)).json({ error: error.message || 'Inventory operation failed.' }); }
}
