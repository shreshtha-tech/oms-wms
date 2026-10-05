import { useEffect, useRef, useState } from 'react';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

const fresh = { orderNo: '', docNo: '' };

function downloadCsv(name: string, headers: string[], rows: any[] = []) {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map(row => headers.map(field => quote(row[field])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function TranshipmentOld() {
  const [meta, setMeta] = useState<any>({});
  const [tab, setTab] = useState('pending');
  const [filters, setFilters] = useState(fresh);
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, size: 20 });
  const [scan, setScan] = useState('');
  const [modal, setModal] = useState('');
  const [auditRecord, setAuditRecord] = useState<any>(null);
  const [pod, setPod] = useState({ pod: '', delDate: '' });
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    void apiGet('/api/transhipment-old').then(setMeta).catch((error: any) => setToast({ msg: error.message, type: 'err' }));
  }, []);

  const err = (msg: string) => setToast({ msg, type: 'err' });
  const search = async (page = 1, size = pager.size) => {
    try {
      const result: any = await apiSend('/api/transhipment-old', 'POST', { ...filters, status: tab, page, rows: size, REQ_SEARCH_FLAG: true });
      setRows(result.gridModel || []);
      setPager({ page: result.page, total: result.total, records: result.records, size });
      setSelected([]);
    } catch (error: any) { err(error.message); }
  };
  const transition = async (to: string, ids = selected, from = tab) => {
    if (!ids.length) return err(from === 'dispatched' ? 'Please select a record to mark delivered.' : 'Select a record to continue.');
    try {
      await apiSend('/api/transhipment-old', 'POST', { action: 'transition', from, to, ids });
    } catch (error: any) { err(error.message); }
  };
  const scanOrder = async () => {
    if (!scan.trim()) return err('Enter an Order No to scan.');
    try {
      const result: any = await apiSend('/api/transhipment-old', 'POST', { action: 'scan', orderNo: scan, status: tab });
      const found = result.crossDocData.crossDocDTOList || [];
      setRows(found);
      setSelected(found.map((row: any) => row.id));
    } catch (error: any) { err(error.message); }
  };
  const exportRows = async () => {
    try {
      const result: any = await apiSend('/api/transhipment-old', 'POST', { action: 'export', status: tab });
      downloadCsv('transhipment-export.csv', meta.importFields || [], result.rows);
      setToast({ msg: `Exported ${result.rows.length} transhipment records.`, type: 'ok' });
    } catch (error: any) { err(error.message); }
  };

  const columns: string[] = meta.columns?.[tab] || [];
  const action = tab === 'pending' ? ['Mark Received', () => transition('received')]
    : tab === 'received' || tab === 'qcFail' ? ['Confirm QC', () => transition('qcPass')]
      : tab === 'packed' ? ['Mark Shipped', () => transition('dispatched')]
        : tab === 'dispatched' ? ['Mark Delivered', () => selected.length ? setModal('Update POD') : err('Select a dispatched record to update delivery details.')]
          : null;

  const cell = (column: string, row: any) => {
    if (column === '' || column === 'Audit') return column === 'Audit'
      ? <button className="text-cyan-700 underline" onClick={() => { setAuditRecord(row); setModal('Audit'); }}>Audit</button>
      : <input aria-label={`Select ${row.orderNo}`} type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />;
    if (column === 'Pack') return <button className="text-cyan-700 underline" onClick={() => void transition('packed', [row.id], 'qcPass')}>PACK</button>;
    if (column === 'Label') return row.label || row.shipping_label || '—';
    if (column === 'Manifest') return row.manifestNo || '—';
    const keys: Record<string, string> = {
      'Doc Date': 'docDate', 'Order No': 'orderNo', 'QC Status': 'qcStatus', 'QC Failed Qty': 'qcFailedQty',
      'QC Reason': 'qcReason', 'Sender Name': 'senderName', 'Receiver Name': 'receiverName', 'Item Name': 'itemName',
      'Item Description': 'itemDescription', 'Receive Details': 'receiveDetails', 'Batch Id': 'batchNo',
      'Expected Receive Date': 'expectedReceiveDate', 'Expected Ship Date': 'expectedShipDate', 'QC Date': 'qcDate',
      'QC By': 'qcBy', 'Tracking No': 'trackingNo', 'Transporter Name': 'transporterName', 'Pack Date': 'packDate',
      'Pack By': 'packBy', 'Status': 'status', 'Del Date': 'del_date', 'Actual Received Date': 'actualReceivedDate',
      'Actual Shiped Date': 'actualShippedDate',
    };
    return row[keys[column] || column] || '—';
  };

  return <Shell active="wms" breadcrumb="WMS > Transhipment Old" openScreens={[{ label: 'Transhipment Old', to: '#' }]}>
    <p role="status" className="mb-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">CSV import and export manage logistics records only. Receiving, QC, packing, dispatch, and delivery updates are unavailable until this workflow is connected to Central Inventory.</p>
    <div className="border bg-white">
      <div className="flex justify-end gap-2 border-b p-3">
        <Btn variant="warn" onClick={() => void search()}>Search</Btn>
        <Btn variant="ghost" onClick={() => { setFilters(fresh); setRows([]); setSelected([]); setScan(''); setPager({ ...pager, page: 1, total: 0, records: 0 }); }}>Reset</Btn>
        <Btn variant="ghost" onClick={() => setModal('Transhipment Import')}>Import</Btn>
        <Btn variant="ghost" onClick={() => void exportRows()}>Export</Btn>
      </div>
      <div className="flex overflow-x-auto border-b">{(meta.tabs || []).map((item: any) => <button key={item[0]} className={`shrink-0 px-3 py-3 ${tab === item[0] ? 'border-b-2 border-cyan-600' : ''}`} onClick={() => { setTab(item[0]); setRows([]); setSelected([]); }}>{item[1]}{tab === item[0] ? ` (${pager.records})` : ''}</button>)}</div>
      <div className="flex flex-wrap items-end gap-2 border-b p-3">
        <label className="text-xs">Order No<input aria-label="Order No" className="inp" value={filters.orderNo} onChange={event => setFilters({ ...filters, orderNo: event.target.value })} /></label>
        <label className="text-xs">Doc No<input aria-label="Doc No" className="inp" value={filters.docNo} onChange={event => setFilters({ ...filters, docNo: event.target.value })} /></label>
        {tab !== 'all' && <><label className="text-xs">Scan Order No<input aria-label="Scan Order No" className="inp" value={scan} onChange={event => setScan(event.target.value)} /></label><Btn variant="ghost" onClick={() => void scanOrder()}>Scan Order</Btn>{action && <Btn onClick={action[1] as any}>{action[0] as string}</Btn>}</>}
      </div>
      <div className="overflow-x-auto"><table className="min-w-[1500px] w-full text-xs"><thead><tr>{columns.map((column, index) => <th className="border p-2" key={index}>{column}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map((column, index) => <td className="border p-2" key={index}>{cell(column, row)}</td>)}</tr>)}</tbody></table>
        {!rows.length && <div className="h-52 p-8 text-center text-slate-500">No records to view. Import transhipment records to get started.</div>}
      </div>
      <div className="flex justify-end gap-3 border-t p-2 text-xs"><button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>Previous</button><span>Page {pager.records ? pager.page : 0} of {pager.total}</span><button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>Next</button><label>Records per Page <select aria-label="Records per Page" value={pager.size} onChange={event => void search(1, Number(event.target.value))}>{(meta.pageSizes || []).map((size: number) => <option key={size}>{size}</option>)}</select></label><span>{pager.records} records</span></div>
      {modal && <Modal title={modal} close={() => setModal('')}>
        {modal === 'Update POD' ? <><Field label="POD Remarks" value={pod.pod} set={value => setPod({ ...pod, pod: value })} /><Field label="Delivery Date" value={pod.delDate} set={value => setPod({ ...pod, delDate: value })} /><Btn onClick={async () => { try { await apiSend('/api/transhipment-old', 'POST', { action: 'pod', ids: selected, ...pod }); setModal(''); await search(pager.page); } catch (error: any) { err(error.message); } }}>Save Delivery Details</Btn></>
          : modal === 'Transhipment Import' ? <Import fields={meta.importFields || []} done={notice => { setToast(notice); setModal(''); void search(1); }} />
            : <div className="grid grid-cols-2 gap-2 text-sm">{[['Created By', auditRecord?.created_by], ['Created Date', auditRecord?.created_date], ['Modified By', auditRecord?.updated_by], ['Modified Date', auditRecord?.updated_date]].map(([label, value]) => <p key={label}><span className="font-medium">{label}: </span>{value || '—'}</p>)}</div>}
      </Modal>}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  </Shell>;
}

function Import({ done, fields }: { done: (notice: any) => void; fields: string[] }) {
  const [clients, setClients] = useState<any[]>([]);
  const [client, setClient] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void apiGet<any[]>('/api/clients').then(rows => setClients(rows.filter(row => row.is_active !== false && String(row.status || 'Active').toLowerCase() === 'active'))).catch((e: any) => setError(e.message));
  }, []);

  const reset = () => { setClient(''); setFile(null); setError(''); if (fileInput.current) fileInput.current.value = ''; };
  const submit = async () => {
    setError('');
    if (!client) return setError('Please select Client.');
    if (!file) return setError('Choose a CSV file to import.');
    if (!file.name.toLowerCase().endsWith('.csv')) return setError('Upload a CSV file.');
    setBusy(true);
    try {
      const result: any = await apiSend('/api/transhipment-old', 'POST', { action: 'import', clientId: client, fileName: file.name, fileContent: await file.text() });
      done({ msg: `Imported ${result.imported} transhipment records.`, type: 'ok' });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3">
    <label className="block text-xs">Client *<select aria-label="Client" className="inp" value={client} onChange={event => setClient(event.target.value)}><option value="">--- Select ---</option>{clients.map(row => { const id = String(row.client_id || row.code); return <option key={id} value={id}>{row.client_name || row.name} ({id})</option>; })}</select></label>
    <label className="block text-xs">CSV File *<input ref={fileInput} aria-label="Upload Template" type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
    <p className="text-xs text-slate-500">CSV only. Maximum 500 data rows and 2 MB per import. Required column: orderNo. Other supported columns: {fields.filter(field => field !== 'orderNo').join(', ')}.</p>
    {!clients.length && <p className="text-xs text-amber-700">No active clients are configured. Add an active client before importing.</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="flex gap-2"><Btn disabled={busy || !clients.length} onClick={() => void submit()}>{busy ? 'Importing…' : 'Import'}</Btn><Btn variant="ghost" onClick={() => downloadCsv('transhipment-import-template.csv', fields)}>Download Template</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn></div>
  </div>;
}

function Modal({ title, close, children }: any) { return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div role="dialog" aria-label={title} className="w-[620px] max-w-[95vw] bg-white"><h3 className="border-b p-3 font-semibold">{title}</h3><div className="space-y-3 p-4">{children}</div><div className="border-t p-3 text-right"><Btn variant="ghost" onClick={close}>Close</Btn></div></div></div>; }
function Field({ label, value, set }: { label: string; value: string; set: (value: string) => void }) { return <label className="block text-xs">{label}<input aria-label={label} className="inp" value={value} onChange={event => set(event.target.value)} /></label>; }
