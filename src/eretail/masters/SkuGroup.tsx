/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect -- API rows are heterogeneous; this screen loads route catalogs and its initial grid on mount. */
import { useEffect, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import Shell from '../Shell';
import EnquiryScreen, { ECol } from '../EnquiryScreen';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';
import { useDownload } from '../../context/DownloadContext';

const blank = { client: '', code: '', name: '', skus: [] as string[], status: 'Active', description: '' };
type ClientPair = [string, string];

export default function SkuGroup() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, pageSize: 20 });
  const [error, setError] = useState<(Error & { status?: number }) | undefined>();
  const lastSearch = useRef<{ filters: any; page: number; size: number }>({ filters: {}, page: 1, size: 20 });
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState<any>(blank);
  const [toast, setToast] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const searchRevision = useRef(0);

  const loadCatalogs = () => apiGet('/api/sku-groups').then((data: any) => {
      setSkus(data.skus || []);
      setClients((data.clients || []).map(([id, name]: ClientPair) => `${id}-${name}`));
    }).catch((error: any) => setToast({ msg: error.message, type: 'err' }));
  useEffect(() => { void loadCatalogs(); const retry = () => { void loadCatalogs(); }; window.addEventListener('api-recovered', retry); return () => window.removeEventListener('api-recovered', retry); }, []);

  const search = async (filters: any = {}, page = 1, size = pager.pageSize) => {
    const revision = ++searchRevision.current;
    lastSearch.current = { filters, page, size };
    setLoading(true);
    try {
      const data: any = await apiSend('/api/sku-groups', 'POST', {
        rows: size, page, sidx: 'skuGrpCode', sord: 'desc',
        clientId: filters.client || '-1', skuGrpCode: filters.code || '',
        skuGrpName: filters.name || '', status: filters.status || '-1', REQ_SEARCH_FLAG: true,
      });
      if (revision !== searchRevision.current) return;
      setError(undefined);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setPager({ page: data.page, total: data.total, records: data.records, pageSize: size });
    } catch (error: any) {
      if (revision === searchRevision.current) { setRows([]); setError(error); }
    } finally {
      if (revision === searchRevision.current) setLoading(false);
    }
  };

  useEffect(() => { void search({}, 1, 20); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const open = (row: any = null) => {
    setEdit(row);
    setForm(row ? { ...blank, ...row } : { ...blank });
    setShow(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiSend('/api/sku-groups', edit ? 'PUT' : 'POST', edit ? { ...form, id: edit.id } : form);
      setShow(false);
      setToast({ msg: edit ? 'SKU Group updated' : 'SKU Group saved', type: 'ok' });
      await search();
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    } finally {
      setSaving(false);
    }
  };

  const cols: ECol[] = [
    { key: 'client', label: 'Client', filter: 'select', options: clients },
    { key: 'code', label: 'SKU Group code', filter: 'text' },
    { key: 'name', label: 'SKU Group Name', filter: 'text' },
    { key: 'no_of_sku', label: 'No of SKU', filter: 'none' },
    { key: 'created_by', label: 'Created By', filter: 'none' },
    { key: 'created_date', label: 'Created Date', filter: 'none' },
    { key: 'updated_by', label: 'Updated By', filter: 'none' },
    { key: 'updated_date', label: 'Updated Date', filter: 'none' },
    { key: 'status', label: 'Status', filter: 'select', options: ['Active', 'InActive'] },
  ];
  const exportRows = () => rows.length
    ? requestDownload({ title: 'SKU Group Enquiry', module: 'sku-group', baseName: 'sku-groups', data: { columns: cols.map(col => col.label), rows: rows.map(row => cols.map(col => row[col.key])) } })
    : setToast({ msg: 'No data in grid to export', type: 'err' });

  return <Shell active="master" breadcrumb="MASTER > Sku Management > SKU Group Enquiry" openScreens={[{ label: 'Manage SKU Group', to: '#' }]}>
    <EnquiryScreen breadcrumb={[{ label: 'Master' }, { label: 'Sku Management' }, { label: 'SKU Group Enquiry' }]} cols={cols} rows={rows} loading={loading} error={error} onRetry={() => { const { filters, page, size } = lastSearch.current; void search(filters, page, size); }} remote={pager} onSearch={search} onReset={() => void search({}, 1, 20)} actions={[{ label: 'Export', icon: Download, onClick: exportRows }, { label: 'Add New', icon: Plus, onClick: () => open() }]} onRowEdit={open} />
    <Modal title={edit ? 'Edit SKU Group' : 'Add New SKU Group'} open={show} onClose={() => setShow(false)} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <L t="Client"><select aria-label="Client" className="inp" value={form.client} onChange={event => setForm({ ...form, client: event.target.value })}><option value="">--- Select ---</option>{clients.map(client => <option key={client} value={client}>{client}</option>)}</select></L>
        <L t="SKU Group Code *"><input className="inp" value={form.code} disabled={!!edit} onChange={event => setForm({ ...form, code: event.target.value })} /></L>
        <L t="SKU Group Name *"><input className="inp" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></L>
        <L t="Status"><select className="inp" value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option>Active</option><option>InActive</option></select></L>
        <L t="SKUs"><select multiple className="inp h-44" value={form.skus} onChange={event => setForm({ ...form, skus: Array.from(event.target.selectedOptions, option => option.value) })}>{skus.map(row => <option key={row.id} value={row.sku_code}>{row.sku_code} - {row.name}</option>)}</select></L>
        <L t="Description"><textarea className="inp" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></L>
      </div>
      <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShow(false)} className="rounded border px-4 py-2">Close</button><button onClick={() => void save()} disabled={saving} className="rounded bg-[#f5a623] px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div>
    </Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="text-xs text-slate-600">{t}<div className="mt-1">{children}</div></label>;
}
