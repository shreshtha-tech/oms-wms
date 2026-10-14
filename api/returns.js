import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { locationPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';
import { listCentralWmsStock } from '../inventory/wms-operations.js';

const day = () => new Date().toISOString().slice(0, 10);
const customerStates = ['Pending Confirmation', 'Confirmed', 'Closed', 'Cancelled'];
const vendorStates = ['Created', 'Confirmed', 'Allocated', 'Shipped', 'Cancelled', 'On Hold'];
const linesValid = (lines) => Array.isArray(lines) && lines.length > 0 && lines.length <= 200 && lines.every((line) => String(line.sku_code || '').trim() && Number(line.qty) > 0);
const numberFor = (prefix) => `${prefix}${String(Date.now()).slice(-8)}`;

function publicCustomer(row) {
  return { ...row, return_no: row.return_no || row.rma_no, return_type: row.return_type || '', category: row.category || '', status: customerStates.includes(row.status) ? row.status : '' };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const entity = req.query?.entity || req.body?.entity || 'legacy';
    if (req.method === 'GET') {
      if (entity === 'rtv') return res.status(200).json((await find('returns', { kind: 'vendor' }, { sort: { id: -1 } })).map((r) => ({ ...r, rtv_no: r.rtv_no || r.rma_no })));
      if (entity === 'customer') return res.status(200).json((await find('returns', {}, { sort: { id: -1 } })).filter((r) => r.kind !== 'vendor').map(publicCustomer));
      if (entity === 'lookups') {
        const [vendors, pos, orders, centralStock, skuRows, transporters] = await Promise.all([
          find('vendors', {}, { sort: { vendor_code: 1 } }), find('purchase_orders', {}, { sort: { id: -1 } }),
          find('sale_orders', {}, { sort: { id: -1 } }), listCentralWmsStock(), find('skus', {}, { sort: { sku_code: 1 } }),
          find('partners', { type: 'Transporter' }, { sort: { name: 1 } }),
        ]);
        const inventory = centralStock.map(stock => {
          const sku = skuRows.find(row => row.sku_code === stock.sku_code) || {};
          return { ...sku, id: stock.master_sku_id, sku_code: stock.sku_code, name: stock.name || sku.name || stock.sku_code,
            warehouse: stock.warehouse, available: stock.available, on_hand: stock.on_hand, cost: Number(sku.cost_price || 0) };
        });
        return res.status(200).json({ vendors, purchaseOrders: pos, orders, inventory, transporters });
      }
      return res.status(200).json(await find('returns', {}, { sort: { id: -1 } }));
    }

    if (req.method === 'POST' && entity === 'vendor') {
      const b = req.body;
      if (!b.site_location || !b.vendor_code || !b.return_type) return res.status(400).json({ error: 'Site Location, Vendor Code and Return Type are required' });
      if (!(await locationPairs()).some(([code]) => code === b.site_location)) return res.status(400).json({ error: 'Select a configured site location' });
      if (b.with_po && !b.po_no) return res.status(400).json({ error: 'PO Code is required for With PO returns' });
      if (!linesValid(b.lines)) return res.status(400).json({ error: 'Enter 1 to 200 SKU lines with a quantity greater than zero' });
      const vendor = await findOne('vendors', { vendor_code: b.vendor_code });
      if (!vendor) return res.status(400).json({ error: 'Select a valid vendor' });
      const total = b.lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.base_cost || 0), 0);
      return res.status(201).json(await insert('returns', {
        kind: 'vendor', rtv_no: numberFor('RTV'), rma_no: numberFor('RTV'), rtv_date: day(), with_po: !!b.with_po,
        po_no: b.po_no || '', site_location: b.site_location, vendor_code: vendor.vendor_code, vendor_name: vendor.vendor_name,
        return_type: b.return_type, remarks: b.remarks || '', status: 'Created', on_hold: false, rtv_qty: b.lines.reduce((sum, l) => sum + Number(l.qty || 0), 0),
        rtv_amount: total, lines: b.lines, udf: b.udf || ['', '', '', '', ''], shipping: [], activity: [{ date: day(), added_by: currentUser(req)?.username || 'unknown', status: 'Created', remark: 'RTV created' }],
      }));
    }

    if (req.method === 'POST' && entity === 'customer') {
      const b = req.body;
      if (!b.external_order_no || !b.delivery_location || !b.return_type) return res.status(400).json({ error: 'Please select orderNo first' });
      if (!(await locationPairs()).some(([code]) => code === b.delivery_location)) return res.status(400).json({ error: 'Select a configured delivery location' });
      if (b.request_type === 'Request & Inbound' && b.return_type !== 'Delivered Return') return res.status(400).json({ error: 'Request & Inbound is available for Delivered Return only' });
      if (b.return_type === 'Delivered Return' && (!b.category || !b.delivery_type)) return res.status(400).json({ error: 'Category and Delivery Type are required for Delivered Return' });
      if (!linesValid(b.lines)) return res.status(400).json({ error: 'Select a return quantity for at least one SKU' });
      const total = b.lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.unit_price || 0), 0);
      const returnNo = numberFor('CR');
      return res.status(201).json(await insert('returns', {
        kind: 'customer', return_no: returnNo, rma_no: returnNo, external_order_no: b.external_order_no, order_no: b.order_no || b.external_order_no,
        customer: b.customer || '', order_type: b.order_type || '', order_channel: b.order_channel || '', delivery_no: b.delivery_no || '',
        delivery_location: b.delivery_location, request_type: b.request_type || 'Request', return_type: b.return_type,
        category: b.return_type === 'Non Delivered Return' ? '' : b.category, delivery_type: b.return_type === 'Non Delivered Return' ? 'Delivery' : b.delivery_type,
        transporter: b.transporter || '', reference_no: b.reference_no || '', remarks: b.remarks || '', lines: b.lines,
        sku_code: b.lines[0].sku_code, qty: b.lines.reduce((sum, l) => sum + Number(l.qty || 0), 0), reason: b.remarks || '',
        return_date: day(), created_user: currentUser(req)?.username || 'unknown', status: 'Pending Confirmation', return_amount: total,
        activity: [{ date: day(), added_by: currentUser(req)?.username || 'unknown', status: 'Pending Confirmation', remark: 'Customer return saved' }], udf: b.udf || ['', '', '', '', ''], comments: [],
      }));
    }

    if (req.method === 'POST' && entity === 'action') {
      const { id, action, remarks = '' } = req.body;
      const current = await findOne('returns', { id: Number(id) });
      if (!current) return res.status(404).json({ error: 'Return record not found' });
      let status = current.status; const patch = {};
      if (current.kind === 'vendor') {
        if (action === 'confirm' && status === 'Created') status = 'Confirmed';
        else if (action === 'quick-ship' && status === 'Allocated') return res.status(501).json({ error: 'Vendor return shipment is unavailable until outbound stock and shipment services are connected. No status or inventory was changed.' });
        else if (action === 'hold' && ['Created', 'Confirmed', 'Allocated'].includes(status)) { status = 'On Hold'; patch.on_hold = true; }
        else if (action === 'cancel' && !['Shipped', 'Cancelled'].includes(status)) status = 'Cancelled';
        else return res.status(409).json({ error: `Cannot ${action} a vendor return in ${status} status` });
      } else {
        if (action === 'confirm' && status === 'Pending Confirmation') status = current.request_type === 'Request & Inbound' ? 'Closed' : 'Confirmed';
        else if (action === 'inbound' && status === 'Confirmed') return res.status(501).json({ error: 'Return receipt is unavailable until physical receipt, QC, and Central Inventory posting are connected. No status or inventory was changed.' });
        else if (action === 'refund' && status === 'Closed') return res.status(501).json({ error: 'Refund processing is not connected. No payment was issued and no refund status was changed.' });
        else if (action === 'cancel' && !['Closed', 'Cancelled'].includes(status)) status = 'Cancelled';
        else if (action === 'comment') { patch.comments = [...(current.comments || []), { date: day(), added_by: currentUser(req)?.username || 'unknown', comment: remarks }]; }
        else return res.status(409).json({ error: `Cannot ${action} a customer return in ${status} status` });
      }
      const activity = [...(current.activity || []), { date: day(), added_by: currentUser(req)?.username || 'unknown', status, remark: remarks || action }];
      const [saved] = await update('returns', Number(id), { ...patch, status, activity });
      const result = current.kind === 'vendor' ? saved : publicCustomer(saved);
      if (action === 'confirm') result.workflowNotice = current.kind === 'vendor'
        ? 'Vendor return record confirmed. No stock was reserved, removed, or shipped.'
        : 'Customer return record confirmed. No physical receipt, QC, stock posting, or refund was performed.';
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      return res.status(501).json({ error: 'Legacy untyped return creation is unavailable. Use a validated customer or vendor return workflow; no record was created.' });
    }
    if (req.method === 'PUT') return res.status(501).json({ error: 'Legacy untyped return updates are unavailable. Use a validated return workflow; no record was changed.' });
    if (req.method === 'DELETE') return res.status(501).json({ error: 'Legacy untyped return deletion is unavailable. Use a validated return workflow; no record was deleted.' });
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('returns error:', { name: err?.name, code: err?.code }); res.status(err.statusCode || err.status || 500).json({ error: err.message }); }
}
