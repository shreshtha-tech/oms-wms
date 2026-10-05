import { sendDatabaseUnavailable, find } from './mongo.js';
import { listCentralWmsStock } from '../inventory/wms-operations.js';
import { summarizeCentralInventory, toLegacyInventoryRows } from '../inventory/legacy-stock-view.js';

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// Reusable dashboard aggregation endpoint.
// GET /api/dashboard?tab=fulfillment&range=7&platform=Amazon,Flipkart&location=All&from=&to=&drill=<metric|status|platform|date|sku:VALUE>
//
// - range: 7 | 14 | 30 | custom (with from/to yyyy-mm-dd)
// - platform: comma list or "All"
// - location: single or "All"
// - drill: when present, returns { orders: [...] } filtered to the contributing records
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const q = req.query;
    const range = String(q.range || '7');
    const platforms = q.platform && q.platform !== 'All'
      ? String(q.platform).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const location = q.location && q.location !== 'All' ? String(q.location) : null;

    // date window
    const now = new Date();
    let from, to;
    if (range === 'custom' && q.from && q.to) {
      from = new Date(String(q.from) + 'T00:00:00');
      to = new Date(String(q.to) + 'T23:59:59');
    } else {
      const days = range === '14' ? 14 : range === '30' ? 30 : 7;
      to = new Date(now); to.setHours(23, 59, 59, 999);
      from = new Date(now); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);
    }

    // De-duplicate marketplace imports: unique by order_no (guard against dup imports)
    const seen = new Set();
    let orders = (await find('sale_orders')).map(row => {
      const lines = Array.isArray(row.lines) ? row.lines : Array.isArray(row.line_items) ? row.line_items : [];
      const status = String(row.status || '');
      const orderDate = row.order_date || row.created_at || '';
      const quantity = Number(row.qty || lines.reduce((sum, line) => sum + Number(line.qty || 0), 0));
      return {
        ...row,
        order_no: row.order_no || String(row.id),
        external_order_no: row.external_order_no || row.ext_order_no || '',
        platform: row.platform || row.channel || '',
        location: row.location || row.warehouse || row.fulfillment_location || '',
        order_date: orderDate, date_key: String(orderDate).slice(0, 10),
        status, fulfilment_status: row.fulfilment_status || '', payment_mode: row.payment_mode || '',
        lines: lines.map(line => ({ sku: line.sku || line.sku_code || '', qty: Number(line.qty || 0) })),
        lines_count: lines.length, qty: quantity, amount: Number(row.amount || 0),
        discount: Number(row.discount || 0), pending_stock_qty: Number(row.pending_stock_qty || 0),
        unfulfillable_lines: Number(row.unfulfillable_lines || 0),
        valid: !['Failed', 'Cancelled'].includes(status),
        pending: ['Pending', 'Confirmed'].includes(status),
        failed: status === 'Failed', sla_breached: Boolean(row.sla_breached),
        unfulfillable: Boolean(row.unfulfillable),
      };
    }).filter((o) => {
      if (seen.has(o.order_no)) return false; seen.add(o.order_no);
      const d = new Date(o.order_date);
      if (Number.isNaN(d.getTime())) return false;
      if (d < from || d > to) return false;
      if (platforms && !platforms.includes(o.platform)) return false;
      if (location && o.location !== location) return false;
      return true;
    });

    // ---- Drill-down: return contributing order records ----
    if (q.drill) {
      const drill = String(q.drill);
      let recs = orders;
      if (drill.startsWith('date:')) recs = orders.filter((o) => o.date_key === drill.slice(5));
      else if (drill.startsWith('platform:')) recs = orders.filter((o) => o.platform === drill.slice(9));
      else if (drill.startsWith('status:')) recs = orders.filter((o) => o.status === drill.slice(7));
      else if (drill.startsWith('fulfil:')) recs = orders.filter((o) => o.fulfilment_status === drill.slice(7));
      else if (drill.startsWith('pay:')) recs = orders.filter((o) => o.payment_mode === drill.slice(4));
      else if (drill.startsWith('sku:')) recs = orders.filter((o) => o.lines.some((l) => l.sku === drill.slice(4)));
      else if (drill === 'kpi:pending') recs = orders.filter((o) => o.pending);
      else if (drill === 'kpi:failed') recs = orders.filter((o) => o.failed);
      else if (drill === 'kpi:sla') recs = orders.filter((o) => o.sla_breached);
      else if (drill === 'kpi:unfulfillable') recs = orders.filter((o) => o.unfulfillable);
      else if (drill === 'kpi:cod') recs = orders.filter((o) => o.payment_mode === 'COD');
      else if (drill === 'kpi:pendingstock') recs = orders.filter((o) => o.pending_stock_qty > 0);
      const rows = recs.slice(0, 500).map((o) => ({
        order_no: o.order_no, external_order_no: o.external_order_no, platform: o.platform,
        location: o.location, order_date: o.order_date, status: o.status,
        fulfilment_status: o.fulfilment_status, payment_mode: o.payment_mode,
        lines: o.lines_count, qty: o.qty, amount: o.amount, discount: o.discount,
      }));
      return res.status(200).json({ orders: rows, count: recs.length });
    }

    if (q.inventory === 'true') {
      const [stock, policies] = await Promise.all([listCentralWmsStock(), find('inventory_policies')]);
      const summary = summarizeCentralInventory(toLegacyInventoryRows(stock), policies);
      const lowStock = summary.filter((row) => row.low_stock);
      return res.status(200).json({ inventory: { summary, low_stock: lowStock, alert_count: lowStock.length }, meta: { generated_at: new Date().toISOString() } });
    }

    // ---- KPI calculations ----
    const totalOrders = orders.length;
    const validOrders = orders.filter((o) => o.valid);
    const totalOrderLines = orders.reduce((a, o) => a + o.lines_count, 0);
    const totalOrderQty = orders.reduce((a, o) => a + o.qty, 0);
    const distinctSku = new Set(orders.flatMap((o) => o.lines.map((l) => l.sku))).size;
    const avgLinesPerOrder = totalOrders ? totalOrderLines / totalOrders : 0;
    const totalAmount = validOrders.reduce((a, o) => a + o.amount, 0);
    const avgOrderAmount = totalOrders ? totalAmount / totalOrders : 0;
    const codOrders = orders.filter((o) => o.payment_mode === 'COD').length;
    const codPct = totalOrders ? (codOrders / totalOrders) * 100 : 0;
    const totalDiscount = orders.reduce((a, o) => a + o.discount, 0);
    const pendingStockQty = orders.reduce((a, o) => a + o.pending_stock_qty, 0);
    const pendingOrders = orders.filter((o) => o.pending).length;
    const unfulfillableLines = orders.reduce((a, o) => a + o.unfulfillable_lines, 0);
    const unfulfillableOrders = orders.filter((o) => o.unfulfillable).length;
    const slaBreached = orders.filter((o) => o.sla_breached).length;
    const failedOrders = orders.filter((o) => o.failed).length;

    const kpis = {
      totalOrders, totalOrderLines, totalOrderQty, distinctSku,
      avgLinesPerOrder: Number(avgLinesPerOrder.toFixed(2)),
      totalAmount: Math.round(totalAmount), avgOrderAmount: Math.round(avgOrderAmount),
      codPct: Math.round(codPct), totalDiscount, pendingStockQty, pendingOrders,
      unfulfillableLines, unfulfillableOrders, slaBreached, failedOrders,
    };

    // ---- Charts ----
    // build date buckets across the window
    const dayList = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) dayList.push(new Date(d).toISOString().slice(0, 10));
    const byDate = Object.fromEntries(dayList.map((k) => [k, { orders: 0, lines: 0, qty: 0, amount: 0, pending: 0, failed: 0 }]));
    orders.forEach((o) => {
      const b = byDate[o.date_key]; if (!b) return;
      b.orders++; b.lines += o.lines_count; b.qty += o.qty; b.amount += o.amount;
      if (o.pending) b.pending++; if (o.failed) b.failed++;
    });
    const dateLabels = dayList.map((k) => k.slice(5)); // MM-DD

    const platformAgg = {};
    orders.forEach((o) => { platformAgg[o.platform] = (platformAgg[o.platform] || 0) + 1; });
    const statusAgg = {};
    orders.forEach((o) => { statusAgg[o.status] = (statusAgg[o.status] || 0) + 1; });
    const fulfilAgg = {};
    orders.forEach((o) => { fulfilAgg[o.fulfilment_status] = (fulfilAgg[o.fulfilment_status] || 0) + 1; });
    const codVsPrepaid = { COD: codOrders, Prepaid: totalOrders - codOrders };
    const skuAgg = {};
    orders.forEach((o) => o.lines.forEach((l) => { skuAgg[l.sku] = (skuAgg[l.sku] || 0) + l.qty; }));
    const topSku = Object.entries(skuAgg).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const charts = {
      dateKeys: dayList,
      orderCountByDate: { labels: dateLabels, values: dayList.map((k) => byDate[k].orders) },
      orderLineByDate: { labels: dateLabels, values: dayList.map((k) => byDate[k].lines) },
      orderQtyByDate: { labels: dateLabels, values: dayList.map((k) => byDate[k].qty) },
      orderAmountByDate: { labels: dateLabels, values: dayList.map((k) => Math.round(byDate[k].amount)) },
      platformWise: { labels: Object.keys(platformAgg), values: Object.values(platformAgg) },
      orderStatus: { labels: Object.keys(statusAgg), values: Object.values(statusAgg) },
      fulfilStatus: { labels: Object.keys(fulfilAgg), values: Object.values(fulfilAgg) },
      codVsPrepaid: { labels: ['COD', 'Prepaid'], values: [codVsPrepaid.COD, codVsPrepaid.Prepaid] },
      pendingFailedTrend: { labels: dateLabels, pending: dayList.map((k) => byDate[k].pending), failed: dayList.map((k) => byDate[k].failed) },
      topSku: { labels: topSku.map((s) => s[0]), values: topSku.map((s) => s[1]) },
    };

    return res.status(200).json({
      kpis, charts,
      meta: {
        from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
        platforms: platforms || 'All', location: location || 'All',
        generated_at: new Date().toISOString(), record_count: totalOrders,
      },
    });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('dashboard error:', { name: err?.name, code: err?.code });
    res.status(err.statusCode || err.status || (err.code || /database|connection/i.test(err.message || '') ? 503 : 500)).json({ error: err.message || 'Dashboard data unavailable.' });
  }
}
