import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const HISTORY = [
  ['6', 'My Last 20 Processed Orders'], ['9', 'Processed LPN History'], ['1', 'Processed Orders History'],
  ['2', 'Scanned SKUs History'], ['3', 'Pending SKUs'], ['7', 'Pack Scanned SKUs'], ['15', 'Sort Scanned SKUs'],
  ['8', 'Show PIP Orders Only'], ['10', 'My Last 20 Processed LPN'], ['4', 'My Last 20 Picked SKUs'],
  ['5', 'My last 20 Packed SKUs'], ['14', 'My last 20 Sorted SKUs'], ['11', 'Sorting Completed'],
  ['12', 'Sorting In-Process'], ['13', 'Sorting Not Started'],
];

function view(pick, orders) {
  return {
    picklistNo: pick.picklist_no,
    picklistQty: Number(pick.total_qty) || orders.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    picklistStatus: pick.status || '',
    description: pick.description || '',
    picker: pick.picker || '',
    mode: pick.pick_mode || '',
    trust: 'legacy-unverified',
    lines: orders.map(row => ({
      id: row.id, orderNo: row.order_no, skuCode: row.sku_code, skuName: row.sku_name,
      requiredQty: Number(row.qty) || 0, processedQty: Number(row.picked_qty) || 0,
      pendingQty: Math.max(0, Number(row.qty || 0) - Number(row.picked_qty || 0)),
      status: row.status || '', bin: row.bin || '', lpn: row.lpn_no || '', deliveryNo: row.delivery_no || '',
    })),
  };
}

async function load(picklistNo) {
  const pick = (await find('picklists')).find(row => text(row.picklist_no).toLowerCase() === text(picklistNo).toLowerCase());
  if (!pick) return null;
  const orders = (await find('fulfillment_orders')).filter(row => row.picklist_no === pick.picklist_no);
  return { pick, orders };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.json({
        scanModes: [['1', 'By SKU'], ['2', 'By Order']],
        historyOptions: HISTORY,
        actions: ['Short Pick / Reallocate', 'Pick All', 'Print Packing Slip', 'Delivery Split', 'Short Pack'],
        available: false,
        notice: 'Physical picking and packing actions are paused until Central Inventory reservation and dispatch services are connected.',
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    if (['scan', 'pick-all', 'short-pick', 'print', 'delivery-split', 'short-pack'].includes(body.action)) {
      return res.status(501).json({ error: 'Physical picking, packing, split, and print actions are paused until Central Inventory reservations, warehouse identity, and dispatch integration are connected.' });
    }
    if (body.action === 'load') {
      if (!text(body.picklistNo)) return res.status(400).json({ error: 'Please Enter PickListNo' });
      const data = await load(body.picklistNo);
      if (!data) return res.status(404).json({ error: 'Invalid PickListNo' });
      if (!data.orders.length) return res.status(409).json({ error: 'Pickable SKU(s) not present in this Picklist.' });
      return res.json({ dto: view(data.pick, data.orders), jsonMessage: null });
    }
    if (body.action === 'history') {
      const all = await find('generic_records', { module: 'manage-picking-history' });
      const rows = (text(body.picklistNo) ? all.filter(row => row.picklist_no === body.picklistNo) : all)
        .slice(-20).reverse().map(row => ({ ...row, trust: 'legacy-unverified' }));
      return res.json({ history: rows, historyType: text(body.historyType) || '6', trust: 'legacy-unverified' });
    }
    return res.status(501).json({ error: 'Manage Picking is read-only until its Central Inventory and physical event workflow is connected.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Manage Picking error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
