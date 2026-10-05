import { useEffect, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

type Filters = { orderNo: string; shipDate: string; trackingNo: string; transporterName: string; isReconcile: string; delNo: string };
type Option = { value: string; label: string };
const initialFilters: Filters = { orderNo: '', shipDate: '', trackingNo: '', transporterName: '-1', isReconcile: '-1', delNo: '' };
const columns = ['Web Order No', 'Ship Date', 'Tracking No', 'Transporter', 'Collectable amount', 'Payment reconciled', 'Cash', 'Credit Card', 'Coupon', 'Received Amount', 'Status', 'Source'];
const fieldClass = 'h-7 w-full min-w-24 rounded border border-slate-300 bg-white px-1 text-xs';

export default function CodReconciliation() {
  const [meta, setMeta] = useState<any>(null), [filters, setFilters] = useState<Filters>(initialFilters);
  const [rows, setRows] = useState<any[]>([]), [selected, setSelected] = useState<number[]>([]), [loading, setLoading] = useState(false);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, pageSize: 20 }), [toast, setToast] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false), [importText, setImportText] = useState(''), [failed, setFailed] = useState('');
  useEffect(() => { void apiGet('/api/cod-reconciliation').then(setMeta); }, []);
  const search = async (page = 1, pageSize = pager.pageSize, active = filters) => {
    if (!active.transporterName || active.transporterName === '-1') return setToast({ msg: 'Please select transporter', type: 'err' });
    setLoading(true);
    try {
      const [shipStartDate = '', shipEndDate = ''] = active.shipDate.split(' - ');
      const result: any = await apiSend('/api/cod-reconciliation', 'POST', { orderNo: active.orderNo, transporterName: active.transporterName, trackingNo: active.trackingNo, shipStartDate, shipEndDate, isReconcile: active.isReconcile, delNo: active.delNo, rows: pageSize, page, sidx: '', sord: 'asc', REQ_SEARCH_FLAG: true });
      setRows(result.rows); setPager({ page: result.page, total: result.total, records: result.records, pageSize }); setSelected([]);
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); } finally { setLoading(false); }
  };
  const reset = () => { setFilters({ ...initialFilters, isReconcile: '0' }); setRows([]); setSelected([]); setFailed(''); setPager({ page: 1, total: 0, records: 0, pageSize: 20 }); };
  const setAmount = (id: number, key: string, value: string) => setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value, recievedAmount: key.startsWith('settledamt') ? (Number(key === 'settledamtCash' ? value : row.settledamtCash) + Number(key === 'settledamtCC' ? value : row.settledamtCC) + Number(key === 'settledamtCoupon' ? value : row.settledamtCoupon)).toFixed(2) : row.recievedAmount } : row));
  const reconcile = async (action: 'reconcile' | 'force-reconcile') => {
    const items = rows.filter((row) => selected.includes(row.id) && (action === 'force-reconcile' || row.isReconcile !== 'Yes'));
    if (!items.length) return setToast({ msg: 'Please Select Record For Process.', type: 'err' });
    try {
      const result: any = await apiSend('/api/cod-reconciliation', 'POST', { action, flag: action === 'reconcile' ? 'Reconcile' : 'ForceReconcile', cODReconciliationGridData: items.map((row) => action === 'reconcile' ? [row.delNo, row.collectedAmount, row.settledamtCash, row.settledamtCC, row.settledamtCoupon].join('|') : [row.delNo, row.orderNo].join('|')).join('~'), items });
      const changed = new Map(result.successFailList.map((row: any) => [row.id, row])); setRows((current) => current.map((row) => changed.get(row.id) || row)); setSelected([]);
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  };
  const download = async () => {
    if (!rows.length) return setToast({ msg: 'No Data In Grid To Export', type: 'err' });
    try { const result: any = await apiSend('/api/cod-reconciliation', 'POST', { action: 'export', filters, gridDataLen: rows.length }); setToast({ msg: `Pending Report created: ${result.reportId}`, type: 'ok' }); } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  };
  const importRows = async () => {
    if (!importText.trim()) return setToast({ msg: 'Nothing To Import', type: 'err' });
    if (importText.split(/\r?\n/).filter((line) => line.trim()).length > 500) return setToast({ msg: 'Maximum 500 records can be imported at a time', type: 'err' });
    try {
      const result: any = await apiSend('/api/cod-reconciliation', 'POST', { action: 'import', cODReconciliationImport: importText });
      const failures = result.successFailList.filter((row: any) => row.fail), successes = result.successFailList.filter((row: any) => !row.fail);
      setRows(successes); setPager({ page: 1, total: successes.length ? 1 : 0, records: successes.length, pageSize: 20 });
      setFailed(failures.map((row: any) => `${row.trackingNo}, ${row.importStatus}`).join('\n'));
      setToast({ msg: successes.length && failures.length ? 'SKU Imported with some failed records. Please Check Failed Records.' : failures.length ? 'Invalid Data.' : 'Successfully uploaded', type: failures.length ? 'err' : 'ok' });
      setImportText(''); setImportOpen(false);
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  };
  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const filterFor = (column: string) => {
    if (column === 'Web Order No') return <input aria-label="Web Order No" className={fieldClass} value={filters.orderNo} onChange={(e) => setFilters({ ...filters, orderNo: e.target.value })}/>;
    if (column === 'Ship Date') return <input aria-label="Ship Date" className={fieldClass} value={filters.shipDate} onChange={(e) => setFilters({ ...filters, shipDate: e.target.value })}/>;
    if (column === 'Tracking No') return <input aria-label="Tracking No" className={fieldClass} value={filters.trackingNo} onChange={(e) => setFilters({ ...filters, trackingNo: e.target.value })}/>;
    if (column === 'Transporter') return <select aria-label="Transporter" className={fieldClass} value={filters.transporterName} onChange={(e) => setFilters({ ...filters, transporterName: e.target.value })}><option value="-1">--- Select ---</option>{(meta?.transporters || []).map((item: Option) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
    if (column === 'Payment reconciled') return <select aria-label="Payment reconciled" className={fieldClass} value={filters.isReconcile} onChange={(e) => setFilters({ ...filters, isReconcile: e.target.value })}>{(meta?.reconciliation || []).map((item: Option) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
    return null;
  };
  const cell = (row: any, column: string) => {
    const key: Record<string, string> = { 'Web Order No': 'orderNo', 'Ship Date': 'shipDate', 'Tracking No': 'trackingNo', Transporter: 'transporterName', 'Collectable amount': 'collectableAmount', 'Payment reconciled': 'isReconcile', Cash: 'settledamtCash', 'Credit Card': 'settledamtCC', Coupon: 'settledamtCoupon', 'Received Amount': 'recievedAmount', Status: 'status', Source: 'orderSource' };
    if (column === 'Payment reconciled') return <span className={`inline-block min-w-16 px-2 py-1 ${row.isReconcile === 'Yes' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'}`}>{row.isReconcile}</span>;
    if (['Cash', 'Credit Card', 'Coupon'].includes(column)) return <input aria-label={`${column} for ${row.orderNo}`} className="w-20 border-0 bg-transparent text-right text-xs focus:border focus:bg-white" value={row[key[column]]} onChange={(e) => setAmount(row.id, key[column], e.target.value)}/>;
    return row[key[column]];
  };
  return <Shell active="sales" breadcrumb="SALES > COD Reconciliation" openScreens={[{ label: 'COD Reconciliation', to: '#' }]}>
    <div className="border bg-white">
      <div className="flex items-center justify-between border-b p-3"><h2 className="font-semibold text-slate-700">Sales COD Reconciliation</h2><div className="flex flex-wrap gap-2"><Btn variant="warn" onClick={() => void search()}>Search</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn><Btn variant="ghost" disabled title="Requires authorized settlement evidence and an auditable reconciliation transaction." onClick={() => void reconcile('reconcile')}>Reconcile</Btn><Btn variant="ghost" disabled title="Force reconciliation is unavailable without verified settlement evidence and approval controls." onClick={() => void reconcile('force-reconcile')}>Force Reconcile</Btn><Btn variant="ghost" disabled title="No COD report-generation worker is connected." onClick={() => void download()}><Download size={15}/>Download</Btn><Btn variant="ghost" disabled title="Settlement import is unavailable until remittance identity and duplicate handling are connected." onClick={() => setImportOpen(true)}><Upload size={15}/>Upload tracking No</Btn></div></div>
      <p role="note" className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">This screen can search stored COD rows. Reconciliation, force reconciliation, settlement import and report download are unavailable until verified remittance evidence and auditable settlement processing are connected.</p>
      {failed && <div className="border-b bg-rose-50 p-3"><b className="text-sm">Import Failed SKU List</b><textarea aria-label="Failed Imports" readOnly className="mt-2 h-24 w-full border bg-white p-2 text-xs" value={failed}/></div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-xs"><thead className="bg-slate-100"><tr><th className="w-9 border p-2"><input aria-label="Select all" type="checkbox" checked={!!rows.length && rows.filter((row) => row.isReconcile !== 'Yes').every((row) => selected.includes(row.id))} onChange={(e) => setSelected(e.target.checked ? rows.filter((row) => row.isReconcile !== 'Yes').map((row) => row.id) : [])}/></th>{columns.map((column) => <th key={column} className="border p-2 text-left">{column}</th>)}</tr><tr><th className="border"/>{columns.map((column) => <th key={column} className="border p-1">{filterFor(column)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="border p-2 text-center"><input aria-label={`Select ${row.orderNo}`} type="checkbox" disabled={row.isReconcile === 'Yes'} checked={selected.includes(row.id)} onChange={() => toggle(row.id)}/></td>{columns.map((column) => <td key={column} className="border p-2">{cell(row, column)}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="h-56 border-t p-4 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No records to view'}</div>}</div>
      <div className="flex items-center justify-end gap-2 border-t p-2 text-xs"><button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>‹</button><span>Page {pager.page} of {pager.total}</span><button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>›</button><select aria-label="Page size" value={pager.pageSize} onChange={(e) => void search(1, Number(e.target.value))}>{[20,50,100,200].map((size) => <option key={size}>{size}</option>)}</select><span>{pager.records ? `View ${(pager.page - 1) * pager.pageSize + 1} - ${Math.min(pager.page * pager.pageSize, pager.records)} of ${pager.records}` : 'No records to view'}</span></div>
    </div>
    {importOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div role="dialog" aria-label="Import" className="w-[620px] rounded border bg-white shadow-xl"><div className="border-b bg-slate-100 px-4 py-2 font-semibold">Import</div><div className="p-4"><textarea aria-label="COD Reconciliation Import" className="h-48 w-full border p-2 font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)}/><div className="mt-3 text-xs leading-5"><b>**Note: Please enter SkuCode</b><br/>Atleast one of Collected amt Cash,Collected amt CC,Collected amt Coupon is mandatory<br/>eg: TrackingNo1,100,100,100<br/>TrackingNo2,100,200,200<br/><b>**Note: Max 500 lines are allowed at a time</b></div></div><div className="flex justify-end gap-2 border-t p-3"><Btn onClick={() => void importRows()}>OK</Btn><Btn variant="ghost" onClick={() => { setImportText(''); setImportOpen(false); }}>Close</Btn></div></div></div>}
    {toast && <Toast {...toast} onClose={() => setToast(null)}/>}
  </Shell>;
}
