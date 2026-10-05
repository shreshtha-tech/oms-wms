import { useEffect, useState } from 'react';

type MongoStatus = { selectedDatabase?: string; datasetState: string; presentCollections?: number; populatedCollections?: number };

export default function MongoStatusBanner() {
  const [status, setStatus] = useState<MongoStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch('/api/health/databases', { credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
        if (response.status === 401 || response.status === 403) { if (!stopped) setStatus(null); return; }
        const body = await response.json();
        if (!stopped) setStatus(body.mongodb || { datasetState: 'INSPECTION_UNAVAILABLE' });
      } catch { if (!stopped) setStatus({ datasetState: 'INSPECTION_UNAVAILABLE' }); }
      finally { clearTimeout(deadline); if (!stopped) timer = setTimeout(poll, 30000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  if (!status) return null;
  const message = status.datasetState === 'EMPTY_UNINITIALISED' ? 'No data in this database'
    : status.datasetState === 'POPULATED' ? `Database reachable · ${status.populatedCollections} collections contain data`
    : status.datasetState === 'AUTHENTICATION_FAILED' ? 'Database authentication failed'
    : status.datasetState === 'UNREACHABLE' ? 'Database temporarily unavailable'
    : status.datasetState === 'ACCESS_DENIED' ? 'Database inspection permission denied'
    : status.datasetState === 'UNCONFIGURED' ? 'Persistent database is not configured'
    : 'Database status could not be checked';
  return <div role="status" className={`mb-3 rounded border px-3 py-2 text-sm ${status.datasetState === 'POPULATED' ? 'border-slate-200 bg-white text-slate-600' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>Legacy data: {message}{status.selectedDatabase && <> — {status.selectedDatabase}</>}</div>;
}
