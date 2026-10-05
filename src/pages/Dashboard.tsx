import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, IndianRupee, Boxes, ArrowUpRight,
  PackageCheck, Clock, Undo2, ClipboardList, AlertTriangle,
} from 'lucide-react';
import { apiGet, money } from '../lib/api';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import CentralInventorySummary from '../components/CentralInventorySummary';

export default function Dashboard() {
  const [orders, setOrders] = useState<any[]>([]);
  const [inv, setInv] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [rets, setRets] = useState<any[]>([]);
  const [stock, setStock] = useState<any>({ summary: [], low_stock: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet('/api/sale-orders'), apiGet('/api/inventory'),
      apiGet('/api/purchase-orders'), apiGet('/api/returns'), apiGet('/api/inventory?summary=true'),
    ]).then(([o, i, p, r, s]) => { setOrders(o); setInv(i); setPos(p); setRets(r); setStock(s); })
      .finally(() => setLoading(false));
  }, []);

  const totalSales = orders.reduce((s, o) => s + Number(o.amount || 0), 0);
  const openOrders = orders.filter((o) => o.status === 'Confirmed' || o.status === 'Ready to Ship').length;
  const shipped = orders.filter((o) => o.status === 'Shipped' || o.status === 'Delivered').length;
  const invValueKnown = inv.length > 0 && inv.every((x) => x.wac !== null && x.wac !== undefined && Number.isFinite(Number(x.wac)));
  const invValue = invValueKnown ? inv.reduce((s, x) => s + Number(x.on_hand || 0) * Number(x.wac), 0) : null;
  const lowStock = stock.low_stock?.length || 0;
  const openPos = pos.filter((p) => p.status === 'Open').length;

  const byChannel: Record<string, number> = {};
  orders.forEach((o) => { byChannel[o.channel] = (byChannel[o.channel] || 0) + Number(o.amount || 0); });
  const channelMax = Math.max(1, ...Object.values(byChannel));

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const trend = days.map((d, i) => ({ d, v: orders.filter(o => {
    const date = new Date(o.order_date || o.created_at || '');
    return !Number.isNaN(date.getTime()) && (date.getDay() + 6) % 7 === i && Date.now() - date.getTime() <= 7 * 86400000;
  }).reduce((sum, order) => sum + Number(order.amount || 0), 0) }));
  const trendMax = Math.max(1, ...trend.map((t) => t.v));

  const kpis = [
    { label: 'Total Sales', value: money(totalSales), icon: IndianRupee, tint: 'from-blue-500 to-blue-600', up: `${orders.length} recorded orders` },
    { label: 'Open Orders', value: openOrders, icon: ShoppingCart, tint: 'from-amber-500 to-orange-500', up: `${orders.length} total` },
    { label: 'Orders Shipped', value: shipped, icon: PackageCheck, tint: 'from-emerald-500 to-teal-600', up: 'Shipped or delivered' },
    { label: 'Inventory Value', value: invValue === null ? 'Unavailable' : money(invValue), icon: Boxes, tint: 'from-violet-500 to-purple-600', up: `${new Set(inv.map((x) => x.sku_code).filter(Boolean)).size} SKUs · valuation not recorded` },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" breadcrumb="Home / Dashboard" />
      <CentralInventorySummary />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-white" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{k.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-800">{k.value}</p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${k.tint} text-white`}>
                    <k.icon size={18} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <ArrowUpRight size={13} /> {k.up}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* Sales trend */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Weekly Sales Trend</h3>
                <span className="text-xs text-slate-400">Recorded orders · last 7 days</span>
              </div>
              <div className="flex h-48 items-end justify-between gap-2">
                {trend.map((t) => (
                  <div key={t.d} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex w-full items-end justify-center" style={{ height: '160px' }}>
                      <div className="w-full max-w-[38px] rounded-t-md bg-gradient-to-t from-[#2f9e9e] to-[#4a7bc8] transition-all hover:opacity-80"
                        style={{ height: t.v ? `${Math.max(2, (t.v / trendMax) * 100)}%` : '0%' }} title={money(t.v)} />
                    </div>
                    <span className="text-[11px] text-slate-400">{t.d}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Channel mix */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Sales by Channel</h3>
              <div className="space-y-3">
                {Object.entries(byChannel).sort((a, b) => b[1] - a[1]).map(([ch, v]) => (
                  <div key={ch}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600">{ch}</span>
                      <span className="text-slate-400">{money(v)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#2f7fb6] to-[#4a7bc8]" style={{ width: `${(v / channelMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={16} /> Application low-stock thresholds</h3>
              <Link to="/app/inventory" className="text-xs font-medium text-amber-800 hover:underline">Review inventory</Link>
            </div>
            {stock.low_stock?.length ? <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-xs text-amber-800"><th className="py-2 pr-4">Central SKU</th><th className="py-2 pr-4">Product</th><th className="py-2 pr-4">Available across locations</th><th className="py-2">Reorder point</th></tr></thead><tbody>{stock.low_stock.slice(0, 6).map((row:any)=><tr key={row.master_sku_code} className="border-t border-amber-200"><td className="py-2 pr-4 font-medium">{row.master_sku_code}</td><td className="py-2 pr-4">{row.name}</td><td className="py-2 pr-4">{row.available}</td><td className="py-2">{row.reorder_point}</td></tr>)}</tbody></table></div> : <p className="text-sm text-amber-800">No configured Central SKU thresholds are at or below available stock. Set a threshold in inventory view.</p>}
          </div>

          {/* quick tiles */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Open Purchase Orders', value: openPos, icon: ClipboardList, to: '/app/purchase-orders', color: 'text-sky-600 bg-sky-50' },
              { label: 'Low Stock SKUs', value: lowStock, icon: Boxes, to: '/app/inventory', color: 'text-rose-600 bg-rose-50' },
              { label: 'Pending Returns', value: rets.filter((r) => r.status === 'Requested').length, icon: Undo2, to: '/app/returns', color: 'text-purple-600 bg-purple-50' },
              { label: 'Ready to Ship', value: orders.filter((o) => o.status === 'Ready to Ship').length, icon: Clock, to: '/app/sale-orders', color: 'text-amber-600 bg-amber-50' },
            ].map((t) => (
              <Link key={t.label} to={t.to} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${t.color}`}><t.icon size={20} /></div>
                <div>
                  <p className="text-xl font-bold text-slate-800">{t.value}</p>
                  <p className="text-xs text-slate-400">{t.label}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* recent orders */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Recent Sale Orders</h3>
              <Link to="/app/sale-orders" className="flex items-center gap-1 text-xs font-medium text-[#2f7fb6] hover:underline">
                View all <ArrowUpRight size={13} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-4">Order No</th><th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Customer</th><th className="py-2 pr-4">Amount</th><th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 6).map((o) => (
                    <tr key={o.id} className="border-b border-slate-50">
                      <td className="py-2.5 pr-4 font-medium text-[#2f7fb6]">{o.order_no}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{o.channel}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{o.customer}</td>
                      <td className="py-2.5 pr-4 font-medium text-slate-700">{money(o.amount)}</td>
                      <td className="py-2.5"><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
