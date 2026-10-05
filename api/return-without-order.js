import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
import { currentUser } from './auth-session.js';

const text = value => String(value ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);
const returnCode = () => `CRW${Date.now().toString().slice(-10)}`;
const totals = lines => ({
  returnQty: lines.reduce((sum, line) => sum + Number(line.returnQty || 0), 0),
  returnAmount: lines.reduce((sum, line) => sum + Number(line.lineamount || 0), 0),
});
const customerFor = async code => (await find('partners', { type: 'Customer' })).find(row =>
  [row.customer_code, row.code, row.external_code].some(value => text(value).toLowerCase() === text(code).toLowerCase()));
const reasonsFor = async () => (await find('generic_records', { module: 'return-reason' }))
  .filter(row => row.status !== 'Inactive' && text(row.code) && text(row.name))
  .map(row => [text(row.code), text(row.name)]);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.json({
      reasons: await reasonsFor(), maxSkus: 200,
      columns: ['SKU Code', 'Image', 'Return Qty', 'LPN', 'Attributes', 'Unit Price', 'Line Amount', 'Reason', 'Order No', 'Delivery No', 'Delete'],
    });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const actor = currentUser(req)?.username || 'unknown';

    if (body.action === 'create-reason') {
      const name = text(body.name);
      if (!name) return res.status(400).json({ error: 'Enter a return reason.' });
      const existing = await find('generic_records', { module: 'return-reason' });
      if (existing.some(row => text(row.name).toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Return reason already exists.' });
      const code = `RR${Math.max(0, ...existing.map(row => Number(text(row.code).replace(/^RR/, '')) || 0)) + 1}`;
      await insert('generic_records', { module: 'return-reason', code, name, status: 'Active', created_by: actor, created_date: today() });
      return res.status(201).json({ code, name, reasons: await reasonsFor() });
    }
    if (body.action === 'customer') {
      const code = text(body.custCode);
      if (!code) return res.status(400).json({ error: 'Customer Code is required' });
      const customer = await customerFor(code);
      if (!customer) return res.status(400).json({ error: 'Invalid Customer Code.' });
      return res.json({ map: { CustCode: code, ClientId: text(customer.client_id) }, reasons: await reasonsFor() });
    }
    if (body.action === 'scan') {
      const customer = await customerFor(body.custCode);
      if (!customer) return res.status(400).json({ error: 'Select a configured customer.' });
      if (!text(body.scannedSkuCode)) return res.status(400).json({ error: 'SKU Code is required' });
      const reason = (await reasonsFor()).find(([code]) => code === text(body.reason));
      if (!reason) return res.status(400).json({ error: 'Select a configured return reason.' });
      const qty = Number(body.scannQty);
      if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Scan Qty must be greater than zero.' });
      const sku = (await find('skus')).find(row => [row.sku_code, row.barcode, row.sku_barcode]
        .some(value => text(value).toLowerCase() === text(body.scannedSkuCode).toLowerCase()));
      if (!sku) return res.status(400).json({ error: 'Select a configured SKU.' });
      const records = await find('generic_records', { module: 'return-without-order' });
      const draft = records.find(row => row.returnCode === text(body.returnNo) && row.status === 'Open');
      if (text(body.returnNo) && !draft) return res.status(409).json({ error: 'This return is no longer open.' });
      if ((draft?.lines?.length || 0) >= 200) return res.status(400).json({ error: 'A return may contain at most 200 SKU lines.' });
      if (draft && draft.customerCode !== text(body.custCode)) return res.status(400).json({ error: 'Customer does not match this return.' });
      const unit = Number(sku.sale_price || sku.mrp || sku.cost_price || 0);
      const line = {
        id: Date.now(), skuCode: sku.sku_code, displaySku: sku.sku_code, skuDesc: sku.name || '',
        skuImgUrlToShow: sku.image || '', returnQty: qty, lpn: text(body.lpn),
        attributes: [sku.size, sku.color || sku.colour].filter(Boolean).join('/'),
        unitPrice: unit, lineamount: unit * qty, reasonCode: reason[0], reason: reason[1],
        orderNo: '', delNOs: '', uomName: sku.uom || '', returnUOMQty: qty, barCode: sku.barcode || '',
      };
      const lines = [...(draft?.lines || []), line];
      if (draft) {
        const [saved] = await update('generic_records', draft.id, { lines, ...totals(lines), modifiedBy: actor, modifiedDate: today() });
        return res.json(saved);
      }
      return res.json(await insert('generic_records', {
        module: 'return-without-order', returnCode: returnCode(), customerCode: text(body.custCode),
        clientId: text(customer.client_id), status: 'Open', statusCode: '10', createDateText: today(),
        createdBy: actor, modifiedBy: actor, modifiedDate: today(), remarks: '', lines, ...totals(lines),
      }));
    }

    const draft = (await find('generic_records', { module: 'return-without-order' }))
      .find(row => row.returnCode === text(body.returnNo));
    if (!draft) return res.status(404).json({ error: 'Return not found' });
    if (body.action === 'print') return res.status(400).json({ error: 'Use the return download control to print this record.' });
    if (draft.status !== 'Open') return res.status(409).json({ error: 'This return is no longer open.' });
    if (body.action === 'updateLines') {
      const ids = new Set(Array.isArray(body.lineIds) ? body.lineIds.map(String) : []);
      const lines = (draft.lines || []).filter(line => ids.has(String(line.id)));
      const [saved] = await update('generic_records', draft.id, { lines, ...totals(lines), modifiedBy: actor, modifiedDate: today() });
      return res.json(saved);
    }
    if (body.action === 'confirm') {
      if (!text(body.remarks)) return res.status(400).json({ error: 'Remark is Mandatory.' });
      if (!draft.lines?.length) return res.status(400).json({ error: 'Scan at least one SKU.' });
      const [saved] = await update('generic_records', draft.id, { remarks: text(body.remarks), status: 'Confirmed', statusCode: '20', modifiedBy: actor, modifiedDate: today() });
      saved.workflowNotice = 'Return record confirmed. No physical receipt, QC, or Central Inventory stock posting occurred.';
      return res.json(saved);
    }
    if (body.action === 'cancel') {
      const [saved] = await update('generic_records', draft.id, { status: 'Cancelled', statusCode: '90', modifiedBy: actor, modifiedDate: today() });
      return res.json(saved);
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('return without order error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
