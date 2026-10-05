import { sendDatabaseUnavailable, find, cors } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const same = (value, query) => text(value).toLowerCase() === text(query).toLowerCase();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const orderno = text(req.body?.orderno);
    const searchType = text(req.body?.searchType);
    if (!orderno) return res.json({ jsonMessage: null, orderMap: null });
    const orders = await find('sale_orders', {});
    const purchaseOrders = searchType === '4' ? await find('purchase_orders', {}) : [];
    const returns = searchType === '6' ? await find('returns', {}) : [];
    let orderMap = null;
    if (searchType === '4') {
      const row = purchaseOrders.find((item) => [item.po_no, item.po_code].some((value) => same(value, orderno)));
      if (row) orderMap = { PO: row.po_no || row.po_code };
    } else if (searchType === '6') {
      const row = returns.find((item) => [item.reverse_awb_no, item.reverse_tracking_no, item.tracking_no].some((value) => same(value, orderno)));
      if (row) orderMap = { [row.return_no || row.customer_return_no]: row.process_id || 'WMS060' };
    } else {
      const fields = {
        '1': ['external_order_no', 'ext_order_no', 'order_no'],
        '2': ['awb_no', 'tracking_no'],
        '3': ['sub_order_id'],
        '5': ['lpn', 'lpn_no'],
        '7': ['invoice_no', 'external_invoice_no'],
      }[searchType] || [];
      const row = orders.find((item) => fields.some((field) => same(item[field], orderno)));
      if (row) {
        const owner = text(row.order_source).toUpperCase() === 'SELLER PANEL' ? 'SP' : 'WMS';
        const type = text(row.order_type_code || row.order_type || 'SO').toUpperCase();
        orderMap = { [`${owner}_${type}`]: row.order_no || orderno };
      }
    }
    return res.json({ jsonMessage: null, orderMap });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('global header search error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ jsonMessage: error.message, orderMap: null });
  }
}
