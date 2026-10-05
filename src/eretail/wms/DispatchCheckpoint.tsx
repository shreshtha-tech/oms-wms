import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Shell from '../Shell';
import OrderGrid, { GCol } from '../OrderGrid';
import { Btn, Panel, Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

const EMPTY_FILTERS = {
  loadId: '', vehicleNo: '', transporter: '-1', status: '-1', isB2b: '-1',
  fromCreatedDate: '', toCreatedDate: '', fromCloseDate: '', toCloseDate: '',
};

function saveCsv(rows: any[]) {
  const columns = [
    ['Load Id', 'loadId'], ['Created Date', 'createdDateString'], ['Closed Date', 'closedDateString'],
    ['Vehicle No', 'vehicleNo'], ['Transporter', 'transporter'], ['Status', 'status'],
    ['Scanned LPN', 'scannedLpn'], ['Total LPN', 'totalLpn'], ['Flow', 'flow'], ['Record Trust', 'trust'],
  ];
  const csv = [columns.map(([label]) => label), ...rows.map(row => columns.map(([, key]) => row[key] ?? ''))]
    .map(values => values.map(value => {
      const raw = String(value);
      const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dispatch-checkpoint-legacy-unverified.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function DispatchCheckpoint() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const loadId = searchParams.get('loadId') || '';
  const [meta, setMeta] = useState<any>({ transporters: [], statuses: [], flows: [], pageSizes: [20, 50, 100, 200] });
  const [filters, setFilters] = useState<any>({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, size: 20 });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    apiGet('/api/dispatch-checkpoint')
      .then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message || 'Unable to load Dispatch Checkpoint', type: 'err' }));
  }, []);

  useEffect(() => {
    if (!loadId) { setDetail(null); return; }
    const query = new URLSearchParams({ loadId });
    apiGet(`/api/dispatch-checkpoint?${query.toString()}`)
      .then((result: any) => setDetail(result.row))
      .catch((error: Error) => setToast({ msg: error.message || 'Unable to load the dispatch record', type: 'err' }));
  }, [loadId]);

  async function search(page = 1, size = pager.size) {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/dispatch-checkpoint', 'POST', {
        ...filters, rows: size, page, REQ_SEARCH_FLAG: true,
      });
      setRows(result.gridModel);
      setPager({ page: result.page, total: result.total, records: result.records, size });
    } catch (error: any) {
      setRows([]);
      setToast({ msg: error.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFilters({ ...EMPTY_FILTERS });
    setRows([]);
    setPager({ page: 1, total: 0, records: 0, size: 20 });
    setToast(null);
  }

  const columns: GCol[] = [
    { key: 'loadId', label: 'Load Id', render: row => <button className="font-semibold text-sky-700 underline" onClick={() => navigate(`/app/r/dispatch-checkpoint?loadId=${encodeURIComponent(row.loadId)}`)}>{row.loadId}</button> },
    { key: 'createdDateString', label: 'Created Date' }, { key: 'closedDateString', label: 'Closed Date' },
    { key: 'vehicleNo', label: 'Vehicle No' }, { key: 'transporter', label: 'Transporter' },
    { key: 'status', label: 'Status' }, { key: 'scannedLpn', label: 'Scanned LPN' },
    { key: 'totalLpn', label: 'Total LPN' }, { key: 'flow', label: 'Flow' }, { key: 'trust', label: 'Record Trust' },
  ];
  const shipmentColumns: GCol[] = [
    { key: 'scanTrackingNo', label: 'Tracking No' }, { key: 'dilveryNo', label: 'Delivery No' },
    { key: 'orderNo', label: 'Order No' }, { key: 'orderDate', label: 'Order Date' },
  ];
  const invoiceColumns: GCol[] = [
    { key: 'invoiceNo', label: 'Invoice No' }, { key: 'lpnList', label: 'LPNs', render: row => Array.isArray(row.lpnList) ? row.lpnList.join(', ') : '' },
    { key: 'pod', label: 'POD' }, { key: 'status', label: 'Status' },
  ];

  return (
    <Shell active="wms" breadcrumb="WMS > Dispatch Checkpoint" openScreens={[{ label: 'Dispatch Checkpoint', to: '/app/r/dispatch-checkpoint' }]}>
      <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Dispatch Checkpoint is read-only. Stored vehicle, carrier, invoice, tracking, LPN, and completion rows are legacy and unverified; adding or closing a load requires verified carrier events and a Central Inventory dispatch transaction.
      </div>
      {loadId ? (
        <Panel title={`Dispatch Checkpoint · ${loadId}`}>
          <div className="mb-4 flex justify-end"><Btn variant="ghost" onClick={() => navigate('/app/r/dispatch-checkpoint')}>Back to enquiry</Btn></div>
          {!detail ? <p className="text-sm text-slate-500">No legacy record found for this Load Id.</p> : <>
            <div className="mb-4 grid gap-3 rounded border bg-slate-50 p-3 text-sm md:grid-cols-4">
              {[['Load Id', detail.loadId], ['Created', detail.createdDateString], ['Closed', detail.closedDateString], ['Vehicle', detail.vehicleNo], ['Carrier', detail.transporter], ['Status', detail.status], ['Scanned LPN', detail.scannedLpn], ['Total LPN', detail.totalLpn], ['Flow', detail.flow], ['Record Trust', detail.trust]].map(([label, value]) => <span key={label}>{label}<br /><b>{value || '—'}</b></span>)}
            </div>
            <h3 className="mb-2 text-sm font-semibold">Stored Tracking Rows <span className="font-normal text-amber-800">(unverified)</span></h3>
            <OrderGrid cols={shipmentColumns} rows={detail.shipments || []} empty="No stored tracking rows" />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Stored Invoice and LPN Rows <span className="font-normal text-amber-800">(unverified)</span></h3>
            <OrderGrid cols={invoiceColumns} rows={detail.invoices || []} empty="No stored invoice rows" />
          </>}
        </Panel>
      ) : (
        <Panel title="WMS Dispatch Checkpoint Enquiry">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs text-slate-600">Load Id<input aria-label="Load Id" className="inp mt-1" value={filters.loadId} onChange={event => setFilters({ ...filters, loadId: event.target.value })} /></label>
            <label className="text-xs text-slate-600">Vehicle No<input aria-label="Vehicle No" className="inp mt-1" value={filters.vehicleNo} onChange={event => setFilters({ ...filters, vehicleNo: event.target.value })} /></label>
            <label className="text-xs text-slate-600">Transporter<select aria-label="Transporter" className="inp mt-1" value={filters.transporter} onChange={event => setFilters({ ...filters, transporter: event.target.value })}><option value="-1">--- Select ---</option>{(meta.transporters || []).map((row: any) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
            <label className="text-xs text-slate-600">Status<select aria-label="Status" className="inp mt-1" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>{(meta.statuses || []).map((row: string[]) => <option key={row[0]} value={row[0]}>{row[1]}</option>)}</select></label>
            <label className="text-xs text-slate-600">Flow<select aria-label="Flow" className="inp mt-1" value={filters.isB2b} onChange={event => setFilters({ ...filters, isB2b: event.target.value })}>{(meta.flows || []).map((row: string[]) => <option key={row[0]} value={row[0]}>{row[1]}</option>)}</select></label>
            <label className="text-xs text-slate-600">Created From<input aria-label="Created From" type="date" className="inp mt-1" value={filters.fromCreatedDate} onChange={event => setFilters({ ...filters, fromCreatedDate: event.target.value })} /></label>
            <label className="text-xs text-slate-600">Created To<input aria-label="Created To" type="date" className="inp mt-1" value={filters.toCreatedDate} onChange={event => setFilters({ ...filters, toCreatedDate: event.target.value })} /></label>
            <label className="text-xs text-slate-600">Closed From<input aria-label="Closed From" type="date" className="inp mt-1" value={filters.fromCloseDate} onChange={event => setFilters({ ...filters, fromCloseDate: event.target.value })} /></label>
            <label className="text-xs text-slate-600">Closed To<input aria-label="Closed To" type="date" className="inp mt-1" value={filters.toCloseDate} onChange={event => setFilters({ ...filters, toCloseDate: event.target.value })} /></label>
          </div>
          <div className="my-3 flex flex-wrap gap-2">
            <Btn onClick={() => void search()}>Search</Btn>
            <Btn variant="ghost" onClick={reset}>Reset</Btn>
            <Btn variant="ghost" onClick={() => rows.length ? saveCsv(rows) : setToast({ msg: 'No data in grid to export', type: 'err' })}>Export CSV</Btn>
          </div>
          <OrderGrid cols={columns} rows={rows} loading={loading} empty="No records to view" />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600">
            <button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>‹</button>
            <span>Page {pager.records ? pager.page : ''} of {pager.total}</span>
            <button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>›</button>
            <select aria-label="Page size" value={pager.size} onChange={event => void search(1, +event.target.value)}>{[20, 50, 100, 200].map(size => <option key={size}>{size}</option>)}</select>
            <span>{pager.records ? `View ${(pager.page - 1) * pager.size + 1} - ${Math.min(pager.page * pager.size, pager.records)} of ${pager.records}` : 'No records to view'}</span>
          </div>
        </Panel>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}
