import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { X, Download, FileText, FileSpreadsheet, FileJson, FileCode, FileType, File } from 'lucide-react';
import { FORMATS, FormatKey, buildFile, humanSize, ExportData } from '../lib/exporters';
import { apiSend } from '../lib/api';
import { useAuth } from './AuthContext';
import { downloadBlob } from '../lib/downloadBlob';

type ReqOpts = { title: string; module: string; data: ExportData; baseName?: string; formats?: FormatKey[]; exportedBy?: string };
type PendingReq = (ReqOpts & { baseName: string }) | null;

type DownloadCtx = {
  requestDownload: (opts: ReqOpts) => void;
};

const Ctx = createContext<DownloadCtx>({ requestDownload: () => {} });

// Broadcast so the Downloads dropdown/page can refresh instantly (no page reload).
export const DOWNLOADS_EVENT = 'downloads:updated';
const notifyDownloads = () => window.dispatchEvent(new CustomEvent(DOWNLOADS_EVENT));

const ICONS: Record<FormatKey, any> = {
  csv: FileSpreadsheet, excel: FileSpreadsheet, json: FileJson, txt: FileText, html: FileCode, pdf: FileType,
};

function triggerBrowserDownload(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<PendingReq>(null);
  const [busy, setBusy] = useState<FormatKey | null>(null);
  const [error, setError] = useState('');

  const requestDownload = useCallback((opts: ReqOpts) => {
    setError('');
    setPending({ ...opts, baseName: opts.baseName || opts.module || 'export' });
  }, []);

  const shownFormats = pending?.formats
    ? FORMATS.filter((f) => pending.formats!.includes(f.key))
    : FORMATS;

  const doDownload = async (format: FormatKey) => {
    if (!pending || busy) return;
    setBusy(format);
    setError('');
    try {
    if (format === 'excel' || format === 'pdf') {
      const record = await apiSend('/api/downloads', 'POST', {
        action: format === 'pdf' ? 'generate-pdf' : 'generate-xlsx', title: pending.title, baseName: pending.baseName, data: pending.data,
      });
      triggerBlobDownload(downloadBlob(record), record.filename);
      notifyDownloads();
      setPending(null);
      return;
    }
    const { content, mime, ext } = buildFile(format, pending.title, pending.data);
    const filename = `${pending.baseName}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const exportedBy = pending.exportedBy || user?.username || 'system';

    // 1) Register as "Processing" so it appears immediately in Downloads
    let recordId: number | null = null;
    try {
      const rec = await apiSend('/api/downloads', 'POST', {
        filename, format: format.toUpperCase(), module: pending.title,
        row_count: pending.data.rows.length, size: new Blob([content]).size,
        // Keep the generated payload with its history record so every completed
        // export remains available from the existing Downloads dropdown/page.
        content, mime,
        exported_by: exportedBy, status: 'Processing',
      });
      recordId = rec?.id ?? null;
      notifyDownloads();
    } catch { /* non-blocking */ }

    // 2) Generate + download
    triggerBrowserDownload(content, mime, filename);

    // 3) Mark "Completed"
    if (recordId != null) {
      try { await apiSend('/api/downloads', 'PUT', { id: recordId, status: 'Completed' }); } catch { /* ignore */ }
    }
    notifyDownloads();

    setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Ctx.Provider value={{ requestDownload }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => !busy && setPending(null)}>
          <div className="mt-16 w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-xl bg-[#3b8fc4] px-5 py-3.5 text-white">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Download size={16} /> Choose export format</h3>
              <button onClick={() => !busy && setPending(null)} className="rounded p-0.5 hover:bg-white/20"><X size={16} /></button>
            </div>
            <div className="p-5">
              {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
              <p className="mb-1 text-sm text-slate-600">Exporting <b className="text-slate-800">{pending.title}</b></p>
              <p className="mb-4 text-xs text-slate-400">{pending.data.rows.length} row(s) · pick a file type below. Every download is saved to your Downloads history.</p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {shownFormats.map((f) => {
                  const Icon = ICONS[f.key] || File;
                  return (
                    <button key={f.key} onClick={() => doDownload(f.key)} disabled={!!busy}
                      className="group flex flex-col items-start gap-1 rounded-lg border border-slate-200 p-3 text-left transition hover:border-[#2f9e9e] hover:bg-[#f0fafa] disabled:opacity-50">
                      <div className="flex w-full items-center justify-between">
                        <Icon size={20} className="text-[#2f9e9e]" />
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">.{f.ext}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-700">{busy === f.key ? 'Processing…' : f.label}</span>
                      <span className="text-[11px] leading-tight text-slate-400">{f.desc}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Estimated size (CSV): {humanSize(new Blob([buildFile('csv', pending.title, pending.data).content]).size)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useDownload = () => useContext(Ctx);
