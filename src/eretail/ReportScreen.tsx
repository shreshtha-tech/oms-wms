import { useEffect, useRef, useState } from 'react';
import { FileBarChart, Download, Printer, Play, Calendar } from 'lucide-react';
import Shell from './Shell';
import { Panel, Btn, Toast } from './parts';
import { apiGet } from '../lib/api';
import { useDownload } from '../context/DownloadContext';
import { useActiveLocations } from '../hooks/useActiveLocations';
import { reportPrintHtml } from '../lib/reportPrint';

// numeric-looking columns get right-aligned + money formatting where sensible
const MONEY_KEYWORDS = ['Amount', 'Revenue', 'Value', 'Price', 'MRP', 'Cost'];
const isMoneyCol = (col: string) => MONEY_KEYWORDS.some((k) => col.includes(k));
type ReportResult = {
  reportKey: string; title: string;
  filters: { warehouse: string; from: string; to: string };
  data: { columns: string[]; rows: any[][] };
};

export default function ReportScreen({
  reportKey, title, crumb,
}: { reportKey: string; title: string; crumb: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouse, setWarehouse] = useState('All');
  const [result, setResult] = useState<ReportResult | null>(null);
  const requestVersion = useRef(0);
  const data = result?.reportKey === reportKey ? result.data : null;
  const filtersChanged = Boolean(data && result && (result.filters.warehouse !== warehouse
    || result.filters.from !== from || result.filters.to !== to));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const { requestDownload } = useDownload();
  const { locations, loading: locationsLoading, error: locationsError } = useActiveLocations();

  const run = () => {
    const version = ++requestVersion.current;
    const filters = { warehouse, from, to };
    setLoading(true);
    setError('');
    setToast(null);
    setResult(null);
    const params = new URLSearchParams({ type: reportKey, warehouse, from, to });
    apiGet(`/api/reports?${params.toString()}`)
      .then((d) => {
        if (version !== requestVersion.current) return;
        setResult({ reportKey, title, filters, data: d });
        if (!d.rows.length) setToast({ msg: 'No records for the selected filters', type: 'ok' });
      })
      .catch((cause) => {
        if (version !== requestVersion.current) return;
        const message = cause instanceof Error ? cause.message : 'Failed to generate report';
        setError(message); setToast({ msg: message, type: 'err' });
      })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
  };
  // auto-run on first load
  useEffect(() => {
    run();
    return () => { requestVersion.current += 1; };
    /* eslint-disable-next-line */
  }, [reportKey]);

  const exportCsv = () => {
    if (!data || !result || filtersChanged || loading) return;
    requestDownload({ title: result.title, module: result.reportKey, baseName: result.reportKey, data });
  };

  const printReport = () => {
    if (!data || !result || filtersChanged || loading) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(reportPrintHtml({ title: result.title, ...result.filters, data }));
    w.document.close(); w.print();
  };

  const fmt = (col: string, val: any) =>
    isMoneyCol(col) && typeof val === 'number'
      ? '₹' + Number(val).toLocaleString('en-IN')
      : val;

  return (
    <Shell active="reports" breadcrumb={crumb} openScreens={[{ label: title, to: '#' }]}>
      {/* Filter bar */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="lbl">From Date</label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
              <Calendar size={14} className="text-slate-400" />
              <input aria-label="From Date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="lbl">To Date</label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
              <Calendar size={14} className="text-slate-400" />
              <input aria-label="To Date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="lbl">Warehouse</label>
            <select aria-label="Warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="inp min-w-[150px]" disabled={locationsLoading}>
              <option value="All">All</option>
              {locations.map((location) => <option key={location.location_code} value={location.location_name}>{location.location_name}</option>)}
            </select>
          </div>
          <Btn onClick={run} disabled={loading}><Play size={14} /> {loading ? 'Generating…' : 'Generate'}</Btn>
          <div className="ml-auto flex items-end gap-2">
            <Btn variant="ghost" onClick={exportCsv} disabled={loading || filtersChanged || !data || !data.rows.length}><Download size={14} /> Export</Btn>
            <Btn variant="ghost" onClick={printReport} disabled={loading || filtersChanged || !data || !data.rows.length}><Printer size={14} /> Print</Btn>
          </div>
        </div>
      </div>
      {locationsError && <p role="alert" className="mb-3 text-sm text-rose-600">{locationsError}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      {filtersChanged && <p role="status" className="mb-3 text-sm text-amber-700">Filters changed. Select Generate to update the results before exporting or printing.</p>}

      <Panel title={title}>
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <FileBarChart size={14} className="text-[#2f9e9e]" />
          {loading ? 'Generating…' : error ? 'Report unavailable' : data ? `${data.rows.length} row(s)` : 'Ready'}
          {data && result && ` · Warehouse: ${result.filters.warehouse}${result.filters.from ? ` · From ${result.filters.from}` : ''}${result.filters.to ? ` · To ${result.filters.to}` : ''}`}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gradient-to-r from-[#2f3b57] to-[#3a4a6b] text-white">
              <tr>{(data?.columns || []).map((c) => (
                <th key={c} className={`whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide ${isMoneyCol(c) ? 'text-right' : ''}`}>{c}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={data?.columns.length || 6} className="px-4 py-16 text-center text-slate-400">
                  <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#2f9e9e]" /><p className="mt-2 text-xs">Generating report…</p>
                </td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={data?.columns.length || 6} className="px-4 py-16 text-center text-sm text-slate-400">{error || 'No records found for the selected filters'}</td></tr>
              ) : data.rows.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-[#f0fafa]">
                  {r.map((cell, j) => (
                    <td key={j} className={`whitespace-nowrap px-3 py-2.5 text-slate-700 ${isMoneyCol(data.columns[j]) ? 'text-right font-medium' : ''}`}>
                      {fmt(data.columns[j], cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}
