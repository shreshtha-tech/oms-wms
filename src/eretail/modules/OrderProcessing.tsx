import { useEffect, useState } from 'react';
import { Download, Filter, PackageCheck, XCircle, Eye } from 'lucide-react';
import Shell from '../Shell';
import { Panel, ToolBar, Btn, Pill, Toast } from '../parts';
import OrderGrid, { GCol } from '../OrderGrid';
import Modal from '../../components/Modal';
import { apiGet, apiSend, money } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';

const SUBTABS = ['All', 'Pending', 'Allocated', 'Picklist Generated', 'Picking', 'Picked', 'Packed', 'Ready to Ship', 'Manifested', 'Handed Over'];

export default function OrderProcessing() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('All');
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<any | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const load = () => { setLoading(true); apiGet('/api/fulfillment').then(setRows).catch(() => setToast({ msg: 'Failed to load orders', type: 'err' })).finally(() => setLoading(false)); };
  useEffect(load, []);

  const filtered = tab === 'All' ? rows : rows.filter((r) => r.status === tab);
  const toggle = (id: number) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleAll = () => setSel(sel.length === filtered.length ? [] : filtered.map((r) => r.id));

  const allocate = async () => {
    const targets = filtered.filter((r) => sel.includes(r.id) && r.status === 'Pending');
    if (targets.length === 0) return setToast({ msg: 'Select Pending order(s) to allocate', type: 'err' });
    setBusy(true);
    try {
      await apiSend('/api/fulfillment', 'PUT', { ids: targets.map((t) => t.id), status: 'Allocated' });
      setToast({ msg: `${targets.length} order(s) allocated successfully`, type: 'ok' }); setSel([]); load();
    } catch (error: any) { setToast({ msg: error.message || 'Allocation is unavailable until Central Inventory reservations are connected', type: 'err' }); } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (sel.length === 0) return setToast({ msg: 'Select order(s) to cancel', type: 'err' });
    setBusy(true);
    try {
      await apiSend('/api/fulfillment', 'PUT', { ids: sel, status: 'Pending', picklist_no: null });
      setToast({ msg: `${sel.length} order(s) reset to Pending`, type: 'ok' }); setSel([]); load();
    } catch (error: any) { setToast({ msg: error.message || 'Unallocation is unavailable until Central Inventory reservations are connected', type: 'err' }); } finally { setBusy(false); }
  };

  const exportCsv = () => requestDownload({
    title: 'Order Processing', module: 'order-processing', baseName: 'order-processing',
    data: {
      columns: ['Order', 'Channel', 'Customer', 'City', 'Warehouse', 'SKU', 'Qty', 'Amount', 'Status'],
      rows: filtered.map((r) => [r.order_no, r.channel, r.customer, r.city, r.warehouse, r.sku_code, r.qty, r.amount, r.status]),
    },
  });

  const cols: GCol[] = [
    { key: 'order_no', label: 'Order No', render: (r) => <button onClick={() => setView(r)} className="font-medium text-[#2f7fb6] hover:underline">{r.order_no}</button> },
    { key: 'channel', label: 'Channel' }, { key: 'customer', label: 'Customer' }, { key: 'city', label: 'City' },
    { key: 'warehouse', label: 'Warehouse' }, { key: 'sku_code', label: 'SKU' }, { key: 'qty', label: 'Qty' },
    { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
    { key: 'priority', label: 'Priority', render: (r) => <span className={r.priority === 'High' ? 'font-semibold text-rose-600' : 'text-slate-500'}>{r.priority}</span> },
    { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
    { key: 'act', label: '', render: (r) => <button onClick={() => setView(r)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><Eye size={15} /></button> },
  ];

  return (
    <Shell active="wms" breadcrumb="WMS > Order Processing" openScreens={[{ label: 'Order Processing', to: '/app/fulfillment/order-processing' }]}>
      <Panel title="Order Processing">
        <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          These rows are legacy fulfillment records. Allocation and reset are disabled until Central Inventory reservation transactions are connected; this screen cannot change stock or fulfillment status.
        </div>
        <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200 pb-2">
          {SUBTABS.map((s) => (
            <button key={s} onClick={() => { setTab(s); setSel([]); }} className={`rounded px-3 py-1.5 text-xs font-medium ${tab === s ? 'bg-[#2f9e9e] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {s} <span className="opacity-70">({s === 'All' ? rows.length : rows.filter((r) => r.status === s).length})</span>
            </button>
          ))}
        </div>
        <ToolBar>
          <Btn onClick={allocate} disabled title="Central Inventory reservations are not connected"><PackageCheck size={15} /> Allocate</Btn>
          <Btn variant="danger" onClick={cancel} disabled title="Central Inventory reservations are not connected"><XCircle size={15} /> Unallocate / Reset</Btn>
          <Btn variant="ghost" onClick={exportCsv}><Download size={15} /> Export</Btn>
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400"><Filter size={13} /> {sel.length} selected</span>
        </ToolBar>
        <OrderGrid cols={cols} rows={filtered} loading={loading} selectable selected={sel} onToggle={toggle} onToggleAll={toggleAll} empty="No orders in this status" />
      </Panel>

      <Modal title={`Order ${view?.order_no || ''}`} open={!!view} onClose={() => setView(null)} wide>
        {view && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[['Channel', view.channel], ['Customer', view.customer], ['City', view.city], ['Warehouse', view.warehouse], ['SKU', view.sku_code], ['Product', view.sku_name], ['Qty', view.qty], ['Amount', money(view.amount)], ['Payment', view.payment_mode], ['Picklist', view.picklist_no || '—'], ['Courier', view.courier || '—'], ['AWB', view.awb || '—']].map(([k, v]) => (
              <div key={k as string}><p className="text-xs text-slate-400">{k}</p><p className="font-medium text-slate-700">{v}</p></div>
            ))}
            <div className="col-span-full"><Pill status={view.status} /></div>
          </div>
        )}
      </Modal>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}
