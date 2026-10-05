import { sendDatabaseUnavailable, find, cors } from './mongo.js';

// Report engine — builds each report from real collections.
// GET /api/reports?type=<reportKey>&from=&to=&warehouse=
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type = '', warehouse = '', from = '', to = '' } = req.query;

    const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) {
      return res.status(400).json({ error: 'Select valid report dates with From Date on or before To Date.' });
    }
    const numeric = value => {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) throw Object.assign(new Error('A report source record contains an invalid numeric quantity or amount.'), { statusCode: 422 });
      return number;
    };
    const inRange = (d) => {
      const day = String(d || '').slice(0, 10);
      return (!from && !to) || (validDay(day) && (!from || day >= from) && (!to || day <= to));
    };
    const inWh = (w) => !warehouse || warehouse === 'All' || w === warehouse;

    const [skus, so, po, grn, rets, ff, picks, ship, transfers] = await Promise.all([
      find('skus', {}), find('sale_orders', {}),
      find('purchase_orders', {}), find('grn', {}), find('returns', {}),
      find('fulfillment_orders', {}), find('picklists', {}), find('shipments', {}),
      find('stock_transfers', {}),
    ]);

    let columns = [];
    let rows = [];

    switch (type) {
      case 'gr-register':
        columns = ['GRN No', 'PO No', 'Vendor', 'Warehouse', 'GRN Date', 'Received Qty', 'Status'];
        rows = grn.filter((g) => inWh(g.warehouse) && inRange(g.grn_date))
          .map((g) => [g.grn_no, g.po_no, g.vendor, g.warehouse, g.grn_date, g.received_qty, g.status]);
        break;
      case 'po-report':
        columns = ['PO No', 'Vendor', 'Warehouse', 'PO Date', 'Expected', 'Qty', 'Amount', 'Status'];
        rows = po.filter((p) => inWh(p.warehouse) && inRange(p.po_date))
          .map((p) => [p.po_no, p.vendor, p.warehouse, p.po_date, p.expected_date, p.qty, p.amount, p.status]);
        break;
      case 'inbound-qc-report':
        columns = ['GRN No', 'PO No', 'Vendor', 'Received', 'Accepted', 'Rejected', 'QC %'];
        rows = grn.filter((g) => g.qc_done && inWh(g.warehouse) && inRange(g.qc_completed_date || g.grn_date)).map((g) => {
          const invalid=()=>Object.assign(new Error('QC report source quantities are missing or inconsistent. Reconcile the recorded receipt and rejection quantities.'),{statusCode:422});
          const quantity=value=>{
            if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim()))throw invalid();
            const result=Number(value);
            if(!Number.isFinite(result)||result<0)throw invalid();
            return result;
          };
          const received = quantity(g.received_qty);
          if(!Array.isArray(g.qc_rejected))throw invalid();
          const rejected = g.qc_rejected.reduce((sum, line) => sum + quantity(line?.rejQty), 0);
          if(!Number.isFinite(rejected)||rejected>received)throw invalid();
          const accepted = received - rejected;
          return [g.grn_no, g.po_no, g.vendor, received, accepted, rejected,
            received > 0 ? `${Math.round(accepted / received * 100)}%` : '—'];
        });
        break;
      case 'sales-register':
        columns = ['Order No', 'Channel', 'Customer', 'City', 'Date', 'Qty', 'Amount', 'Status'];
        rows = so.filter((o) => inRange(o.order_date))
          .map((o) => [o.order_no, o.channel, o.customer, o.city, o.order_date, o.qty, o.amount, o.status]);
        break;
      case 'purchase-register':
        columns = ['PO No', 'Vendor', 'Warehouse', 'Date', 'Qty', 'Amount', 'Status'];
        rows = po.filter((p) => inWh(p.warehouse) && inRange(p.po_date))
          .map((p) => [p.po_no, p.vendor, p.warehouse, p.po_date, p.qty, p.amount, p.status]);
        break;
      case 'sales-return-register':
        columns = ['RMA No', 'Order No', 'Customer', 'SKU', 'Qty', 'Reason', 'Date', 'Status'];
        rows = rets.filter((r) => inRange(r.return_date))
          .map((r) => [r.rma_no, r.order_no, r.customer, r.sku_code, r.qty, r.reason, r.return_date, r.status]);
        break;
      case 'shipping-label':
        columns = ['Order No', 'Customer', 'City', 'Courier', 'AWB', 'Box', 'Status'];
        rows = ff.filter((o) => o.awb && inWh(o.warehouse))
          .map((o) => [o.order_no, o.customer, o.city, o.courier, o.awb, o.box_no || '-', o.status]);
        break;
      case 'invoice-report':
        columns = ['Invoice No', 'Order No', 'Customer', 'Date', 'Qty', 'Amount', 'Payment'];
        rows = so.filter((o) => o.invoice_no && o.status !== 'Cancelled' && inRange(o.invoice_date || o.order_date))
          .map((o) => [o.invoice_no, o.order_no, o.customer, o.invoice_date || o.order_date, o.qty, o.amount, o.payment_mode]);
        break;
      case 'manifest-report':
        columns = ['Manifest No', 'Courier', 'Warehouse', 'Shipments', 'Handover Date', 'Status'];
        // A locally saved draft is not a dispatched manifest and must not enter the operations report.
        rows = ship.filter((s) => s.record_trust !== 'local-draft-metadata' && inWh(s.warehouse) && inRange(s.handover_date))
          .map((s) => [s.manifest_no, s.courier, s.warehouse, s.shipment_count, s.handover_date, s.status]);
        break;
      case 'dispatch-report':
        columns = ['Order No', 'Courier', 'AWB', 'Warehouse', 'Status', 'Date'];
        rows = ff.filter((o) => ['Manifested', 'Handed Over'].includes(o.status) && inWh(o.warehouse))
          .map((o) => [o.order_no, o.courier, o.awb, o.warehouse, o.status, o.order_date]);
        break;
      case 'fin-inv-sku': {
        return res.status(501).json({ error: 'Financial inventory report requires authoritative Central Inventory balances and recorded valuation.' });
      }
      case 'fin-inv-sku-bin': {
        return res.status(501).json({ error: 'SKU and bin financial inventory report requires authoritative Central Inventory balances, bin attribution and recorded valuation.' });
      }
      case 'inventory-ageing':
        return res.status(501).json({ error: 'Inventory ageing requires receipt-dated stock layers. No verified ageing source is configured.' });
      case 'inventory-ledger':
        return res.status(501).json({ error: 'Inventory ledger report requires the authoritative Central Inventory event history.' });
      case 'sales-report':
        columns = ['Channel', 'Orders', 'Units', 'Revenue'];
        {
          const byCh = Object.create(null);
          so.filter((o) => inRange(o.order_date)).forEach((o) => {
            byCh[o.channel] = byCh[o.channel] || { orders: 0, units: 0, rev: 0 };
            byCh[o.channel].orders++; byCh[o.channel].units += numeric(o.qty); byCh[o.channel].rev += numeric(o.amount);
          });
          rows = Object.entries(byCh).map(([ch, v]) => [ch, v.orders, v.units, v.rev]);
        }
        break;
      case 'sku-wise-sales':
        columns = ['SKU', 'Product', 'Category', 'Units Sold', 'Revenue'];
        {
          const bySku = Object.create(null);
          ff.filter((o) => inWh(o.warehouse) && inRange(o.order_date)).forEach((o) => {
            bySku[o.sku_code] = bySku[o.sku_code] || { name: o.sku_name, units: 0, rev: 0 };
            bySku[o.sku_code].units += numeric(o.qty); bySku[o.sku_code].rev += numeric(o.amount);
          });
          rows = Object.entries(bySku).map(([sku, v]) => {
            const meta = skus.find((s) => s.sku_code === sku);
            return [sku, v.name, meta?.category || '-', v.units, v.rev];
          });
        }
        break;
      case 'order-life-cycle':
        columns = ['Order No', 'Channel', 'Status', 'Warehouse', 'Picklist', 'Courier', 'AWB'];
        rows = ff.filter((o) => inWh(o.warehouse))
          .map((o) => [o.order_no, o.channel, o.status, o.warehouse, o.picklist_no || '-', o.courier || '-', o.awb || '-']);
        break;
      case 'mis-report':
        columns = ['Metric', 'Value'];
        rows = [
          ['Total Sale Orders', so.length],
          ['Total Revenue', so.reduce((s, o) => s + Number(o.amount || 0), 0)],
          ['Open POs', po.filter((p) => p.status === 'Open').length],
          ['Total SKUs', skus.length],
          ['Inventory Units (Central Inventory)', 'Unavailable in this report'],
          ['Open Returns', rets.filter((r) => r.status !== 'Refunded').length],
          ['Fulfillment Orders', ff.length],
          ['Active Picklists', picks.filter((p) => p.status !== 'Completed').length],
        ];
        break;
      case 'pick-pack-report':
        columns = ['Picklist No', 'Warehouse', 'Mode', 'Orders', 'Qty', 'Picker', 'Status'];
        rows = picks.filter((p) => inWh(p.warehouse))
          .map((p) => [p.picklist_no, p.warehouse, p.pick_mode, p.order_count, p.total_qty, p.picker, p.status]);
        break;
      case 'order-unallocation': {
        // Show only recorded unallocation events, never infer a cause from current stock.
        columns = ['Order No', 'Channel', 'Warehouse', 'SKU', 'Qty', 'Available Stock', 'Unallocation Reason', 'Triggered By', 'Status'];
        rows = ff.filter((o) => o.unallocation_date && inWh(o.warehouse) && inRange(o.unallocation_date)).map((o) => {
          return [o.order_no, o.channel, o.warehouse, o.sku_code, o.qty, o.available_at_unallocation ?? '—',
            o.unallocation_reason || 'Not recorded', o.unallocated_by || 'Not recorded', o.status];
        });
        break;
      }
      case 'mis-report-2': {
        // MIS Report 2.0 — richer channel + fulfilment analytics
        columns = ['Channel', 'Orders', 'Units', 'Revenue', 'Avg Order Value', 'Fulfilled %', 'Cancelled'];
        const byCh2 = Object.create(null);
        so.filter((o) => inRange(o.order_date)).forEach((o) => {
          byCh2[o.channel] = byCh2[o.channel] || { orders: 0, units: 0, rev: 0, ful: 0, canc: 0 };
          const b = byCh2[o.channel]; b.orders++; b.units += numeric(o.qty); b.rev += numeric(o.amount);
          if (['Shipped', 'Delivered'].includes(o.status)) b.ful++;
          if (o.status === 'Cancelled') b.canc++;
        });
        rows = Object.entries(byCh2).map(([ch, v]) => [ch, v.orders, v.units, v.rev, Math.round(v.rev / Math.max(1, v.orders)), Math.round((v.ful / Math.max(1, v.orders)) * 100) + '%', v.canc]);
        break;
      }
      case 'sto-report':
        columns = ['Transfer No', 'SKU', 'From', 'To', 'Qty', 'Date', 'Status'];
        rows = transfers.map((t) => [t.transfer_no, t.sku_code, t.from_wh, t.to_wh, t.qty, t.transfer_date, t.status]);
        break;
      default:
        return res.status(400).json({ error: 'Unknown report type: ' + type });
    }

    return res.status(200).json({ columns, rows });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('Report error:', { name: err?.name, code: err?.code });
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}
