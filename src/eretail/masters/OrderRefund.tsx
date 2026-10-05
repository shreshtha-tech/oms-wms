/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect -- API rows are heterogeneous; this screen loads its route catalog on mount. */
import { useEffect, useState } from 'react';
import Shell from '../Shell';
import { Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';
import { buildFile } from '../../lib/exporters';

const sizes = [15, 50, 100, 200];
const heads = ['Payment Type', 'Created date', 'Order No', 'Customer Details', 'Customer Phone', 'Customer Email', 'Delivery No', 'Invoice No', 'Action', 'Status', 'Amount', 'Last Attempt Date'];
const fields = ['payment_type', 'created_date', 'order_no', 'customer_details', 'customer_phone', 'customer_email', 'delivery_no', 'invoice_no', 'action', 'refund_status', 'amount', 'last_attempt_date'];

export default function OrderRefund() {
  const [client, setClient] = useState('-1');
  const [clients, setClients] = useState<[string, string][]>([]);
  const [status, setStatus] = useState(1);
  const [counts, setCounts] = useState<any>({ pending: 0, in_process: 0, processed: 0, failed: 0 });
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [records, setRecords] = useState(0);
  const [size, setSize] = useState(15);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<any>(null);

  const loadMeta = async () => {
    const data: any = await apiGet('/api/order-refunds');
    setCounts(data.counts);
    setClients(data.clients || []);
  };
  useEffect(() => { void loadMeta(); }, []);

  const search = async (nextPage = 1, nextSize = size) => {
    setLoading(true);
    try {
      const data: any = await apiSend('/api/order-refunds', 'POST', { clientID: client, status, REQ_SEARCH_FLAG: true, rows: nextSize, page: nextPage, sidx: '', sord: 'asc' });
      setRows(data.rows);
      setPage(data.page);
      setTotal(data.total);
      setRecords(data.records);
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  const exportRows = () => {
    if (!rows.length) return;
    const { content } = buildFile('csv', 'Order Refund', { columns: heads, rows: rows.map(row => fields.map(field => row[field] ?? '')) });
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    anchor.href = url;
    anchor.download = 'order-refunds-visible-rows.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pages = Math.max(1, total);
  return <Shell active="master" breadcrumb="MASTER > Miscellaneous > Order Refund" openScreens={[{ label: 'Order Refund', to: '#' }]}>
    <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">Refund statuses and counts are legacy records without payment provider verification. Approval and reapproval are unavailable until provider processing and status readback are connected. Export includes only the currently displayed rows.</div>
    <div className="mb-3 flex justify-end gap-2">
      <button onClick={() => void search()} className="rounded border px-4 py-2">Search</button>
      <button onClick={() => { setClient('-1'); setStatus(1); setRows([]); setPage(0); setRecords(0); setTotal(0); }} className="rounded border px-4 py-2">Reset</button>
      <button onClick={exportRows} disabled={!rows.length} className="rounded border px-4 py-2 disabled:opacity-50">Export visible rows</button>
    </div>
    <label className="mb-3 block max-w-sm text-xs">Client<select aria-label="Client" className="inp mt-1" value={client} onChange={event => setClient(event.target.value)}><option value="-1">--- Select ---</option>{clients.map(([id, name]) => <option key={id} value={id}>{id}-{name}</option>)}</select></label>
    <div className="grid grid-cols-4 border bg-white">{[['Payment Pending', 1, counts.pending], ['Payment In Process', 2, counts.in_process], ['Payment Processed', 3, counts.processed], ['Payment Failed', 4, counts.failed]].map(([label, value, count]: any) => <button key={value} onClick={() => { setStatus(value); setRows([]); }} className={`border-r p-4 ${status === value ? 'border-b-2 border-b-red-500 bg-slate-50' : ''}`}><b>{label}</b><div className="text-2xl">{count}</div></button>)}</div>
    <div className="overflow-x-auto border bg-white"><table className="min-w-[1400px] w-full text-sm"><thead className="bg-slate-100"><tr>{heads.map(head => <th key={head} className="p-2 text-left">{head}</th>)}</tr></thead><tbody>
      {loading ? <tr><td colSpan={12} className="p-10 text-center">Loading…</td></tr> : rows.length ? rows.map(row => <tr key={row.id} className="border-t">{fields.map(key => <td key={key} className="p-2">{row[key] ?? ''}</td>)}</tr>) : <tr><td colSpan={12} className="p-10 text-center text-slate-400">No records to view</td></tr>}
    </tbody></table><div className="flex justify-end gap-3 bg-slate-100 p-2"><button disabled={page <= 1} onClick={() => void search(1)}>First</button><button disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button><span>Page {page || 0} of {total}</span><button disabled={!page || page >= pages} onClick={() => void search(page + 1)}>Next</button><button disabled={!page || page >= pages} onClick={() => void search(pages)}>Last</button><select aria-label="Page size" value={size} onChange={event => { const nextSize = Number(event.target.value); setSize(nextSize); void search(1, nextSize); }}>{sizes.map(value => <option key={value}>{value}</option>)}</select><span>{records ? `View ${(page - 1) * size + 1} - ${Math.min(page * size, records)} of ${records}` : 'No records to view'}</span></div></div>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
