import { useEffect, useState } from 'react';
import { Download, Trash2, RefreshCw, FileText, Inbox } from 'lucide-react';
import Shell from './Shell';
import { Panel, ToolBar, Btn, Toast } from './parts';
import OrderGrid, { GCol } from './OrderGrid';
import { apiGet, apiSend } from '../lib/api';
import { humanSize } from '../lib/exporters';
import { downloadBlob } from '../lib/downloadBlob';
import { DOWNLOADS_EVENT } from '../context/DownloadContext';

function StatusTag({ status }: { status: string }) {
  const map: Record<string, string> = {
    Completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Processing: 'bg-amber-50 text-amber-700 ring-amber-200',
    Failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[status] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
    {status === 'Processing' && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />}{status}
  </span>;
}

export default function Downloads() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const load = () => {
    setLoading(true);
    apiGet('/api/downloads').then(setRows)
      .catch(() => setToast({ msg: 'Failed to load downloads', type: 'err' }))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Live-sync: refresh whenever a new export is recorded anywhere in the app.
  useEffect(() => {
    const handler = () => apiGet('/api/downloads').then(setRows).catch(() => {});
    window.addEventListener(DOWNLOADS_EVENT, handler);
    return () => window.removeEventListener(DOWNLOADS_EVENT, handler);
  }, []);

  const redownload = async (r: any) => {
    if (r.status === 'Processing') { setToast({ msg: 'File is still processing…', type: 'err' }); return; }
    setDownloadingId(r.id);
    try {
      const fullRecord = await apiGet(`/api/downloads?id=${encodeURIComponent(r.id)}`);
      const blob = downloadBlob(fullRecord);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fullRecord.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast({ msg: 'Re-downloaded ' + fullRecord.filename, type: 'ok' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Stored export is invalid.', type: 'err' });
    } finally {
      setDownloadingId(null);
    }
  };

  const del = async (id: number) => {
    try { await apiSend('/api/downloads', 'DELETE', { id }); setToast({ msg: 'Removed from history', type: 'ok' }); load(); }
    catch { setToast({ msg: 'Delete failed', type: 'err' }); }
  };

  const clearAll = async () => {
    try { const r = await apiSend('/api/downloads', 'DELETE', { all: true }); setToast({ msg: `Cleared ${r.cleared} download(s)`, type: 'ok' }); load(); }
    catch { setToast({ msg: 'Clear failed', type: 'err' }); }
  };

  const cols: GCol[] = [
    { key: 'filename', label: 'File Name', render: (r) => <span className="flex items-center gap-2 font-medium text-[#2f7fb6]"><FileText size={14} className="text-slate-400" />{r.filename}</span> },
    { key: 'format', label: 'Export Format', render: (r) => <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{r.format}</span> },
    { key: 'module', label: 'Source' },
    { key: 'exported_by', label: 'Exported By', render: (r) => r.exported_by || '—' },
    { key: 'created_at', label: 'Export Date & Time', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'size', label: 'Size', render: (r) => humanSize(r.size || 0) },
    { key: 'status', label: 'Status', render: (r) => <StatusTag status={r.status || 'Completed'} /> },
    { key: 'act', label: 'Actions', render: (r) => (
      <div className="flex gap-1">
        <button onClick={() => redownload(r)} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40" title="Re-download" disabled={r.status === 'Processing' || downloadingId !== null}><Download size={15} /></button>
        <button onClick={() => del(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Remove"><Trash2 size={15} /></button>
      </div>
    ) },
  ];

  return (
    <Shell active="dashboard" breadcrumb="DASHBOARD > Downloads" openScreens={[{ label: 'Downloads', to: '#' }]}>
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#2f9e9e] text-white"><Inbox size={22} /></div>
          <div>
            <h1 className="text-lg font-semibold text-slate-700">Downloads</h1>
            <p className="text-xs text-slate-400">Every file you export across the app is recorded here. Re-download anytime.</p>
          </div>
          <span className="ml-auto text-sm text-slate-500">{rows.length} file(s)</span>
        </div>
      </div>

      <Panel title="Download History">
        <ToolBar>
          <Btn variant="ghost" onClick={load}><RefreshCw size={14} /> Refresh</Btn>
          <Btn variant="danger" onClick={clearAll} disabled={!rows.length}><Trash2 size={14} /> Clear All</Btn>
        </ToolBar>
        <OrderGrid cols={cols} rows={rows} loading={loading} empty="No downloads yet — export from any screen and it will appear here" />
      </Panel>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}
