import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, Download, Eye, RefreshCw, Search } from 'lucide-react';
import { apiGet, money } from '../lib/api';
import { useDownload } from '../context/DownloadContext';
import PageHeader from '../components/PageHeader';
import DataTable, { Col } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

const STATUSES = ['Confirmed', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled'];

export default function SaleOrders() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [view, setView] = useState<any | null>(null);
  const [params] = useSearchParams();
  const [q, setQ] = useState('');

  const load = () => { setLoading(true); setError(''); apiGet<any[]>('/api/sale-orders').then(setRows).catch((cause) => setError(cause.message || 'Unable to load orders.')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  useEffect(() => { const urlQ = params.get('q'); if (urlQ) setQ(urlQ); }, [params]);

  const filtered = (filter === 'All' ? rows : rows.filter((r) => r.status === filter))
    .filter((r) => !q || (`${r.order_no} ${r.customer} ${r.city} ${r.channel}`).toLowerCase().includes(q.toLowerCase()));

  const exportCsv = () => requestDownload({
    title: 'Order Enquiry', module: 'sale-orders', baseName: 'sale-orders',
    data: {
      columns: ['Order No', 'Channel', 'Customer', 'City', 'Date', 'Qty', 'Amount', 'Status'],
      rows: filtered.map((r) => [r.order_no, r.channel, r.customer, r.city, r.order_date, r.qty, r.amount, r.status]),
    },
  });

  const cols: Col<any>[] = [
    { key: 'order_no', label: 'Order No', render: (r) => <button onClick={() => setView(r)} className="font-medium text-[#2f7fb6] hover:underline">{r.order_no}</button> },
    { key: 'channel', label: 'Channel' },
    { key: 'customer', label: 'Customer' },
    { key: 'city', label: 'City' },
    { key: 'order_date', label: 'Date' },
    { key: 'qty', label: 'Qty' },
    { key: 'amount', label: 'Amount', render: (r) => <span className="font-medium">{money(r.amount)}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'act', label: 'Actions', render: (r) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setView(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="View"><Eye size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Manage Sale Orders" breadcrumb="Sales / Sale Orders"
        actions={<>
          <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><RefreshCw size={14} /> Refresh</button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Download size={14} /> Export</button>
        </>} />

      <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">Order records and recorded statuses are read-only here. Creation, cancellation, shipping, and delivery require SKU lines and Central Inventory and carrier events.</p>
      {error && <p role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-slate-400"><Filter size={13} /> Status:</span>
        {['All', ...STATUSES].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${filter === s ? 'bg-[#2f9e9e] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {s} {s !== 'All' && <span className="opacity-60">({rows.filter((r) => r.status === s).length})</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5">
          <Search size={14} className="text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, city…" className="w-52 bg-transparent text-sm outline-none" />
          {q && <button onClick={() => setQ('')} className="text-xs text-slate-400 hover:text-rose-500">clear</button>}
        </div>
      </div>

      <DataTable cols={cols} rows={filtered} loading={loading} empty="No sale orders match this filter" />

      {/* View / workflow modal */}
      <Modal title={`Order ${view?.order_no || ''}`} open={!!view} onClose={() => setView(null)} wide>
        {view && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <StatusBadge status={view.status} />
              <span className="text-sm text-slate-400">{view.order_date}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Info label="Channel" value={view.channel} />
              <Info label="Customer" value={view.customer} />
              <Info label="City" value={view.city} />
              <Info label="Payment" value={view.payment_mode} />
              <Info label="Items" value={view.items} />
              <Info label="Quantity" value={view.qty} />
              <Info label="Amount" value={money(view.amount)} />
            </div>

            <p className="mt-6 text-xs text-amber-800">This status is a stored order value; fulfillment and carrier events are not verified by this screen.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return <div><p className="text-xs text-slate-400">{label}</p><p className="font-medium text-slate-700">{value}</p></div>;
}
