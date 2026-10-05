import { sendDatabaseUnavailable, cors, find, findOne, insert, update } from './mongo.js';
import { locationPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';
import { listCentralWmsStock } from '../inventory/wms-operations.js';

const trim = (v) => String(v ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);
const number = () => `RTV${String(Date.now()).slice(-8)}`;
const validLines = (v) => Array.isArray(v) && v.length > 0 && v.length <= 2000 && v.every(x => trim(x.sku_code) && Number(x.qty) > 0);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const id = Number(req.query?.id || 0);
      if (id) {
        const record = await findOne('returns', { id, kind: 'vendor' });
        return record ? res.json(record) : res.status(404).json({ error: 'Vendor return not found' });
      }
      const [vendors, purchaseOrders, centralStock, skuRows, grns, locations] = await Promise.all([
        find('vendors', {}, { sort: { vendor_code: 1 } }), find('purchase_orders', {}, { sort: { id: -1 } }),
        listCentralWmsStock(), find('skus', {}, { sort: { sku_code: 1 } }),
        find('grn', {}, { sort: { id: -1 } }).catch(() => []), locationPairs(),
      ]);
      const inventory = centralStock.map(stock => {
        const sku = skuRows.find(row => row.sku_code === stock.sku_code) || {};
        return { ...sku, id: stock.master_sku_id, sku_code: stock.sku_code, name: stock.name || sku.name || stock.sku_code,
          warehouse: stock.warehouse, available: stock.available, on_hand: stock.on_hand, cost: Number(sku.cost_price || 0) };
      });
      return res.json({
        sources: [['-1','--- Select ---'],['3','With GRN'],['1','With PO'],['2','Without PO']],
        locations: [['-1','--- Select ---'], ...locations],
        returnTypes: [['-1','--- Select ---'],['12','Normal Return'],['20','Dispose'],['43','Inbound QC'],['10','Damage Return']],
        processing: [['-1','--- Select ---'],['1','B2B Flow'],['0','B2C Flow']], documentTypes: [['-1','--- Select ---'],['3','OTHERS']],
        transportModes: [['1','Road'],['2','Rail'],['3','Air'],['4','Ship'],['5','Part A'],['6','In Transit']], vendors, purchaseOrders, inventory, grns,
      });
    }
    if (!['POST','PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {}, action = b.action || 'save';
    if (action === 'comment') {
      if (!trim(b.comment)) return res.status(400).json({ error: 'Please Enter Some Comments' });
      const row = await findOne('returns', { id: Number(b.id), kind: 'vendor' });
      if (!row) return res.status(404).json({ error: 'Vendor return not found' });
      const comments = [{ date: today(), added_by: currentUser(req)?.username || 'unknown', status: row.status, comment: trim(b.comment) }, ...(row.comments || [])];
      const [saved] = await update('returns', row.id, { comments }); return res.json(saved);
    }
    if (action === 'tags') {
      const row = await findOne('returns', { id: Number(b.id), kind: 'vendor' });
      if (!row) return res.status(404).json({ error: 'Vendor return not found' });
      const [saved] = await update('returns', row.id, { tags: [...new Set((b.tags || []).map(trim).filter(Boolean))] }); return res.json(saved);
    }
    if (action === 'attachment') {
      const row = await findOne('returns', { id: Number(b.id), kind: 'vendor' });
      if (!row) return res.status(400).json({ error: 'RTV No. is mandatory' });
      if (trim(b.doc_type) === '-1' || !trim(b.file_name)) return res.status(400).json({ error: 'Please fill all mandatory fields' });
      const attachments = [...(row.attachments || []), { document_name: trim(b.file_name), document_type: 'OTHERS', delivery_no: trim(b.delivery_no) }];
      const [saved] = await update('returns', row.id, { attachments }); return res.json(saved);
    }
    if (action === 'delete-attachments') {
      if (!(b.indexes || []).length) return res.status(400).json({ error: 'Please select row to delete' });
      const row = await findOne('returns', { id: Number(b.id), kind: 'vendor' });
      const attachments = (row?.attachments || []).filter((_, i) => !b.indexes.includes(i));
      const [saved] = await update('returns', row.id, { attachments }); return res.json({ ...saved, jsonMessage: 'Data deleted successfully' });
    }
    if (action === 'eway-save') {
      const row = await findOne('returns', { id: Number(b.id), kind: 'vendor' });
      if (!row) return res.status(400).json({ error: 'RTV No. is mandatory' });
      const [saved] = await update('returns', row.id, { eway_bill: b.eway_bill || {} }); return res.json(saved);
    }
    const source = trim(b.rtv_source);
    if (source === '-1' || trim(b.site_location) === '-1' || trim(b.return_type) === '-1') return res.status(400).json({ error: 'Please fill all mandatory fields' });
    if (!(await locationPairs()).some(([code]) => code === trim(b.site_location))) return res.status(400).json({ error: 'Please select a configured site location' });
    if (source === '1' && !trim(b.po_no)) return res.status(400).json({ error: 'Please fill all mandatory fields' });
    if (source === '3' && !trim(b.grn_no)) return res.status(400).json({ error: 'Please fill all mandatory fields' });
    if (!validLines(b.lines)) return res.status(400).json({ error: 'Please add at least one SKU' });
    const vendor = await findOne('vendors', { vendor_code: trim(b.vendor_code) });
    if (!vendor) return res.status(400).json({ error: 'Please select a Vendor.' });
    const totalQty = b.lines.reduce((s,x)=>s+Number(x.qty||0),0), total = b.lines.reduce((s,x)=>s+Number(x.qty||0)*Number(x.base_cost||0),0);
    const data = { kind:'vendor', rtv_source:source, with_po:source==='1', po_no:trim(b.po_no), grn_no:trim(b.grn_no), remarks:trim(b.remarks), site_location:b.site_location, return_type:b.return_type_label || b.return_type, return_type_code:b.return_type, vendor_code:vendor.vendor_code, vendor_name:vendor.vendor_name, ext_rtv_no:trim(b.ext_rtv_no), order_processing:b.order_processing || '0', lines:b.lines, udf:(b.udf||Array(10).fill('')).slice(0,10), shipping:b.shipping||[], rtv_qty:totalQty, rtv_amount:total, on_hold:false };
    let saved;
    if (b.id) [saved] = await update('returns', Number(b.id), data); else saved = await insert('returns', { ...data, rtv_no:number(), rma_no:number(), rtv_date:today(), status:'Created', comments:[], attachments:[], tags:[], activity:[{date:today(),added_by:currentUser(req)?.username || 'unknown',status:'Created',remark:'RTV created'}] });
    if (action === 'confirm') {
      if (totalQty <= 0) return res.status(400).json({ error: 'Cannot confirm as Total Return Qty is zero. Please update Return Qty in at least one SKU.' });
      [saved] = await update('returns', saved.id, { status:'Confirmed', activity:[...(saved.activity||[]),{date:today(),added_by:currentUser(req)?.username || 'unknown',status:'Confirmed',remark:'confirm'}] });
      saved.workflowNotice = 'Vendor return record confirmed. No stock was reserved, removed, or shipped.';
    }
    return res.status(b.id ? 200 : 201).json(saved);
  } catch (e) {
    if (sendDatabaseUnavailable(res, e)) return; console.error('vendor return editor error:', { name: e?.name, code: e?.code }); res.status(e.statusCode || e.status || 500).json({ error:e.message }); }
}
