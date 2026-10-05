import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Clock, Zap, TrendingUp, Gauge, Warehouse,
  ArrowRight, RefreshCw, PackageCheck, Flame, CheckCircle2,
} from 'lucide-react';
import Shell from './Shell';
import { Panel, Btn, Toast } from './parts';
import { apiGet, apiSend, money } from '../lib/api';

const PIPELINE = [
  { key: 'Pending', to: '/app/fulfillment/order-processing', color: '#64748b' },
  { key: 'Allocated', to: '/app/fulfillment/allocate', color: '#3b82f6' },
  { key: 'Picklist Generated', to: '/app/fulfillment/manage-picklist', color: '#6366f1' },
  { key: 'Picking', to: '/app/fulfillment/manage-picking', color: '#f59e0b' },
  { key: 'Picked', to: '/app/fulfillment/sort-to-box', color: '#06b6d4' },
  { key: 'Packed', to: '/app/fulfillment/delivery-shipping', color: '#8b5cf6' },
  { key: 'Ready to Ship', to: '/app/fulfillment/shipment-handover', color: '#14b8a6' },
  { key: 'Manifested', to: '/app/fulfillment/shipment-handover', color: '#f97316' },
  { key: 'Handed Over', to: '/app/fulfillment/order-acknowledgement', color: '#22c55e' },
];

// SLA: number of days an order may sit before it's a breach (by stage)
const SLA_DAYS = 2;

function daysOld(dateStr: string) {
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return 0;
  return Math.floor((Date.now() - d) / 86400000);
}

export default function ControlTower() {
  const nav = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [tick, setTick] = useState(0);

  const load = () => { apiGet('/api/fulfillment').then(setOrders).catch(() => setToast({ msg: 'Load failed', type: 'err' })).finally(() => setLoading(false)); };
  useEffect(load, []);
  // live auto-refresh every 20s
  useEffect(() => { const t = setInterval(() => { setTick((x) => x + 1); load(); }, 20000); return () => clearInterval(t); }, []);

  const openStages = ['Pending', 'Allocated', 'Picklist Generated', 'Picking', 'Picked', 'Packed', 'Ready to Ship', 'Manifested'];
  const open = orders.filter((o) => openStages.includes(o.status));

  const stats = useMemo(() => {
    const byStage: Record<string, number> = {};
    PIPELINE.forEach((p) => { byStage[p.key] = orders.filter((o) => o.status === p.key).length; });
    const maxStage = PIPELINE.filter((p) => p.key !== 'Handed Over').reduce((a, b) => (byStage[b.key] > byStage[a.key] ? b : a), PIPELINE[0]);
    const breaches = open.filter((o) => daysOld(o.order_date) >= SLA_DAYS);
    const highPriority = open.filter((o) => o.priority === 'High');
    const byWh: Record<string, number> = {};
    open.forEach((o) => { byWh[o.warehouse] = (byWh[o.warehouse] || 0) + 1; });
    const totalOpenValue = open.reduce((s, o) => s + Number(o.amount || 0), 0);
    const throughput = orders.filter((o) => o.status === 'Handed Over').length;
    const healthScore = Math.max(0, Math.round(100 - (breaches.length / Math.max(1, open.length)) * 60 - (byStage[maxStage.key] / Math.max(1, open.length)) * 40));
    return { byStage, maxStage, breaches, highPriority, byWh, totalOpenValue, throughput, healthScore };
  }, [orders]);

  const funnelMax = Math.max(1, ...PIPELINE.map((p) => stats.byStage[p.key]));

  const bulkAllocate = async () => {
    const pending = orders.filter((o) => o.status === 'Pending');
    if (pending.length === 0) return setToast({ msg: 'No pending orders to allocate', type: 'err' });
    setBusy(true);
    try {
      await apiSend('/api/fulfillment', 'PUT', { ids: pending.map((o) => o.id), status: 'Allocated' });
      setToast({ msg: `Auto-allocated ${pending.length} pending order(s)`, type: 'ok' }); load();
    } catch { setToast({ msg: 'Bulk allocate failed', type: 'err' }); } finally { setBusy(false); }
  };

  const expediteBreaches = async () => {
    if (stats.breaches.length === 0) return setToast({ msg: 'No SLA breaches to expedite', type: 'err' });
    setBusy(true);
    try {
      await apiSend('/api/fulfillment', 'PUT', { ids: stats.breaches.map((o) => o.id), priority: 'High' });
      setToast({ msg: `Flagged ${stats.breaches.length} breached order(s) as High priority`, type: 'ok' }); load();
    } catch { setToast({ msg: 'Expedite failed', type: 'err' }); } finally { setBusy(false); }
  };

  const whMax = Math.max(1, ...Object.values(stats.byWh));

  return (
    <Shell active="dashboard" breadcrumb="DASHBOARD > Fulfillment Control Tower" openScreens={[{ label: 'Control Tower', to: '#' }]}>
      <div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Metrics are calculated from legacy fulfillment records and do not prove Central Inventory reservations or carrier events. Automatic allocation is disabled; priority changes only flag metadata.
      </div>
      {!loading && orders.length === 0 ? <div className="rounded border bg-white p-8 text-center"><h2 className="text-xl font-semibold">No fulfillment orders yet</h2><p className="mt-2 text-sm text-slate-600">Create an order to begin tracking fulfillment, warehouse load, and SLA metrics.</p><button className="mt-4 rounded bg-[#2f9e9e] px-4 py-2 text-sm text-white" onClick={() => nav('/app/order-maintenance')}>Create order</button></div> : <>
      {/* Hero KPI strip */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#1b232f] to-[#2f3b57] p-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/60">Ops Health Score</p>
              <p className="mt-1 text-4xl font-bold">{loading ? '—' : stats.healthScore}<span className="text-lg text-white/50">/100</span></p>
            </div>
            <div className="relative flex h-16 w-16 items-center justify-center">
              <svg className="h-16 w-16 -rotate-90"><circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,.15)" strokeWidth="6" fill="none" /><circle cx="32" cy="32" r="26" stroke={stats.healthScore > 70 ? '#22c55e' : stats.healthScore > 40 ? '#f59e0b' : '#ef4444'} strokeWidth="6" fill="none" strokeDasharray={`${(stats.healthScore / 100) * 163} 163`} strokeLinecap="round" /></svg>
              <Gauge size={18} className="absolute" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-white/50"><Activity size={12} /> Live • auto-refresh 20s</div>
        </div>

        <StatCard icon={AlertTriangle} tint="from-rose-500 to-red-600" label="SLA Breaches" value={loading ? '—' : stats.breaches.length} sub={`> ${SLA_DAYS} days open`} onClick={expediteBreaches} action="Mark High Priority" />
        <StatCard icon={Flame} tint="from-orange-500 to-amber-600" label="High Priority Open" value={loading ? '—' : stats.highPriority.length} sub="need attention" />
        <StatCard icon={TrendingUp} tint="from-emerald-500 to-teal-600" label="Open Order Value" value={loading ? '—' : money(stats.totalOpenValue)} sub={`${open.length} orders in flight`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Pipeline funnel */}
        <div className="lg:col-span-2">
          <Panel title="Fulfillment Pipeline — Live Funnel">
            <div className="space-y-2">
              {PIPELINE.map((p) => {
                const n = stats.byStage[p.key] || 0;
                const isBottleneck = p.key === stats.maxStage.key && n > 0 && p.key !== 'Handed Over';
                return (
                  <button key={p.key} onClick={() => nav(p.to)} className="group flex w-full items-center gap-3 text-left">
                    <span className="w-36 shrink-0 text-sm font-medium text-slate-600">{p.key}</span>
                    <div className="relative h-8 flex-1 overflow-hidden rounded bg-slate-100">
                      <div className="flex h-full items-center rounded px-2 text-xs font-semibold text-white transition-all group-hover:opacity-90" style={{ width: `${Math.max(6, (n / funnelMax) * 100)}%`, background: p.color }}>{n}</div>
                      {isBottleneck && <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] font-bold text-rose-600"><AlertTriangle size={11} /> BOTTLENECK</span>}
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-[#2f9e9e]" />
                  </button>
                );
              })}
            </div>
            {!loading && stats.maxStage && stats.byStage[stats.maxStage.key] > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Zap size={14} /> Bottleneck detected at <b>{stats.maxStage.key}</b> ({stats.byStage[stats.maxStage.key]} orders). Consider assigning more resources to this stage.
              </div>
            )}
          </Panel>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Panel title="Quick Actions">
            <div className="space-y-2">
              <Btn onClick={bulkAllocate} disabled title="Central Inventory reservations are not connected"><PackageCheck size={15} /> Auto-Allocate All Pending</Btn>
              <Btn variant="danger" onClick={expediteBreaches} disabled={busy}><Flame size={15} /> Expedite SLA Breaches</Btn>
              <Btn variant="ghost" onClick={load}><RefreshCw size={15} /> Refresh Now</Btn>
            </div>
          </Panel>

          <Panel title="Warehouse Load">
            {Object.keys(stats.byWh).length === 0 ? <p className="text-sm text-slate-400">No open load</p> : (
              <div className="space-y-3">
                {Object.entries(stats.byWh).sort((a, b) => b[1] - a[1]).map(([wh, n]) => (
                  <div key={wh}>
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="flex items-center gap-1 font-medium text-slate-600"><Warehouse size={12} /> {wh}</span><span className="text-slate-400">{n} orders</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#2f9e9e] to-[#3b8fc4]" style={{ width: `${(n / whMax) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* SLA breach watchlist */}
      <div className="mt-4">
        <Panel title="SLA Breach Watchlist">
          {loading ? <p className="text-sm text-slate-400">Loading…</p> : stats.breaches.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-700"><CheckCircle2 size={16} /> All open orders are within SLA. Nothing breached.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400"><th className="py-2 pr-4">Order</th><th className="py-2 pr-4">Stage</th><th className="py-2 pr-4">Warehouse</th><th className="py-2 pr-4">Age</th><th className="py-2 pr-4">Priority</th><th className="py-2">Value</th></tr></thead>
                <tbody>
                  {stats.breaches.sort((a, b) => daysOld(b.order_date) - daysOld(a.order_date)).map((o) => (
                    <tr key={o.id} className="border-b border-slate-50">
                      <td className="py-2 pr-4 font-medium text-[#2f7fb6]">{o.order_no}</td>
                      <td className="py-2 pr-4 text-slate-600">{o.status}</td>
                      <td className="py-2 pr-4 text-slate-600">{o.warehouse}</td>
                      <td className="py-2 pr-4"><span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600"><Clock size={11} /> {daysOld(o.order_date)}d</span></td>
                      <td className="py-2 pr-4"><span className={o.priority === 'High' ? 'font-semibold text-rose-600' : 'text-slate-500'}>{o.priority}</span></td>
                      <td className="py-2 font-medium text-slate-700">{money(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      </>}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function StatCard({ icon: Icon, tint, label, value, sub, onClick, action }: { icon: any; tint: string; label: string; value: any; sub: string; onClick?: () => void; action?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
          <p className="text-xs text-slate-400">{sub}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${tint} text-white`}><Icon size={18} /></div>
      </div>
      {action && onClick && <button onClick={onClick} className="mt-2 text-xs font-medium text-[#2f9e9e] hover:underline">{action} →</button>}
    </div>
  );
}
