import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { locationPairs, channelRows } from './catalogs.js';
import { centralSkuExists, listCentralWmsStock } from '../inventory/wms-operations.js';
import { searchCentralInventoryRows, summarizeCentralInventory, toLegacyInventoryRows } from '../inventory/legacy-stock-view.js';

const clean = value => String(value ?? '').trim();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      if (String(req.query?.summary) === 'true') {
        const [stock, policies] = await Promise.all([listCentralWmsStock(), find('inventory_policies')]);
        const summary = summarizeCentralInventory(toLegacyInventoryRows(stock), policies);
        return res.status(200).json({ summary, low_stock: summary.filter(row => row.low_stock) });
      }
      if (req.query?.policy !== undefined) {
        const policy = await findOne('inventory_policies', { master_sku_code: clean(req.query.policy) });
        return res.status(200).json(policy || { master_sku_code: clean(req.query.policy), reorder_point: 0 });
      }
      if (String(req.query?.meta) === 'true') {
        const [products, partners, locations, channels] = await Promise.all([find('products'), find('partners'), locationPairs(), channelRows()]);
        return res.status(200).json({
          pageSizes: [20, 50, 100, 200],
          buckets: [['10', 'Good'], ['20', 'Damaged'], ['30', 'Hold']],
          zones: [['-1', '--- Select ---'], ['PICK', 'PICK'], ['STORAGE', 'STORAGE']],
          locations,
          imeiStatuses: [['-1', '--- Select ---'], ['1', 'In Stock'], ['2', 'Out']],
          usnStatuses: [['-1', '--- Select ---'], ['1', 'Available'], ['2', 'Consumed']],
          channels: [['-1', '--- Select ---'], ...channels.map(row => [String(row.channel_code), String(row.channel_name)])],
          inventoryTypes: [['-1', '--- Select ---'], ['FG', 'Finished Good'], ['RM', 'Raw Material']],
          products: products.map(x => ({ id: x.id, code: x.sku_code, name: x.product_name || x.sku_name, barcode: x.barcode || x.primary_upc || '', hierarchy: x.category || x.department || '', brand: x.brand || '' })),
          vendors: partners.filter(x => x.partner_type === 'Vendor').map(x => ({ id: x.id, code: x.vendor_code || String(x.id), name: x.name })),
        });
      }
      const { warehouse } = req.query;
      const stock = toLegacyInventoryRows(await listCentralWmsStock());
      return res.status(200).json(warehouse ? stock.filter(row => row.warehouse === warehouse) : stock);
    }
    if (req.method === 'POST') {
      if (req.body?.action === 'save-policy') {
        const master = clean(req.body.master_sku_code);
        const reorderPoint = Number(req.body.reorder_point);
        if (!master) return res.status(400).json({ error: 'Master SKU is required.' });
        if (!Number.isInteger(reorderPoint) || reorderPoint < 0) return res.status(400).json({ error: 'Reorder point must be a whole number of zero or more.' });
        if (!(await centralSkuExists(master))) return res.status(404).json({ error: 'SKU must match a Central Inventory SKU code.' });
        const current = await findOne('inventory_policies', { master_sku_code: master });
        if (current) return res.status(200).json((await update('inventory_policies', current.id, { reorder_point: reorderPoint, updated_at: new Date().toISOString() }))[0]);
        return res.status(201).json(await insert('inventory_policies', { master_sku_code: master, reorder_point: reorderPoint, updated_at: new Date().toISOString() }));
      }
      if (req.body?.action === 'search' || req.body?.REQ_SEARCH_FLAG) {
        const b = req.body || {}, tab = b.tab || 'sku';
        if (tab !== 'sku') return res.status(501).json({ error: 'Central Inventory currently records SKU and physical-location balances only; bin, lot, serial, BOM, and marketplace inventory views are unavailable.' });
        const unsupported = ['mfgSkuCode', 'hierarchyCode', 'brandCode', 'vendorCode', 'binCode', 'bucket', 'zone', 'lotCode', 'imei', 'uniqueNo', 'channelCode', 'channelSkuCode', 'mpInventory', 'inventoryType', 'siteCode', 'status', 'subStatus', 'poNo', 'uploadDate']
          .find(key => clean(b[key]) && clean(b[key]) !== '-1' && clean(b[key]) !== '10');
        if (unsupported) return res.status(501).json({ error: `${unsupported} is not stored in Central Inventory and cannot be used as an inventory filter.` });
        const source = toLegacyInventoryRows(await listCentralWmsStock());
        const items = searchCentralInventoryRows(source, b).map(row => ({
          id: row.id,
          skuCode: row.sku_code,
          skuDesc: row.name,
          totalQty: row.on_hand,
          availableQty: row.available,
          commitedQty: row.reserved,
          siteLocation: row.warehouse,
        }));
        const rows = [20, 50, 100, 200].includes(+b.rows) ? +b.rows : 20, page = Math.max(1, +b.page || 1), records = items.length, total = Math.ceil(records / rows);
        return res.status(200).json({ rows: items.slice((page - 1) * rows, page * rows), page, total, records, sidx: b.sidx || 'sku', sord: b.sord || 'desc' });
      }
      return res.status(501).json({ error: 'Inventory balances can only be changed through Central Inventory workflows.' });
    }
    if (req.method === 'PUT') {
      return res.status(501).json({ error: 'Inventory balances can only be changed through Central Inventory workflows.' });
    }
    if (req.method === 'DELETE') {
      return res.status(501).json({ error: 'Inventory balances can only be changed through Central Inventory workflows.' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('API error:', { name: err?.name, code: err?.code }); res.status(err.statusCode || err.status || (err.code || /database|connection/i.test(err.message || '') ? 503 : 500)).json({ error: err.message || 'Inventory request failed.' }); }
}
