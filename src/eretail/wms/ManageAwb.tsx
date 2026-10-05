import { useEffect, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import EnquiryScreen from '../EnquiryScreen';
import Shell from '../Shell';
import { Btn, Panel, Toast } from '../parts';

const fresh = { siteLocCode: '', transporterCode: '-1', orderType: '-1', status: '0',
  mode: 'single', singleAwb: '', prefix: '', fromAwb: '', toAwb: '', suffix: '', courierType: '1' };

export default function ManageAwb() {
  const [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [meta, setMeta] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(false);
  const [editor, setEditor] = useState(false);
  const [form, setForm] = useState({ ...fresh });
  const [selected, setSelected] = useState<number[]>([]);
  const [last, setLast] = useState<any>({});
  const [toast, setToast] = useState<any>(null);
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiText, setMultiText] = useState('');
  const [multiApply, setMultiApply] = useState<null | ((value: string) => void)>(null);

  useEffect(() => { apiGet('/api/manage-awb').then(setMeta).catch((error: Error) => setToast({ msg: error.message, type: 'err' })); }, []);

  async function search(filters: any = {}, page = 1, size = pager.pageSize) {
    setLast(filters);
    setLoading(true);
    try {
      const response: any = await apiSend('/api/manage-awb', 'POST', {
        action: summary ? 'summary' : 'search', REQ_SEARCH_FLAG: true, rows: size, page,
        sidx: 'awbNo', sord: 'asc', locationCode: filters.locationName || '',
        fromAwbSearchNo: filters.awbNo || '', toAwbSearchNo: '', status: filters.status || '0',
        orderType: filters.orderType || '-1', awbTransporter: filters.awbSearchTransporter || '-1',
        transporter: filters.awbSearchTransporter || '-1', awbReverse: filters.courierType || 'Select',
      });
      setRows(summary ? response.awbSummarySearchDTOs : response.awbDetailSearchDTOs);
      setPager({ page: response.page, total: response.total, records: response.records, pageSize: size });
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
      setRows([]);
      setPager({ page: 0, total: 0, records: 0, pageSize: size });
    } finally { setLoading(false); }
  }

  function resetEnquiry() {
    setRows([]); setSelected([]); setLast({});
    setPager({ page: 0, total: 0, records: 0, pageSize: 20 }); setToast(null);
  }

  async function saveAwb() {
    try {
      const response: any = await apiSend('/api/manage-awb', 'POST', form);
      setToast({ msg: response.jsonMessage, type: 'ok' });
      await search(last);
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  }

  async function deleteSelected() {
    if (!selected.length) return setToast({ msg: 'Please select free AWB record(s) to delete', type: 'err' });
    try {
      const response: any = await apiSend('/api/manage-awb', 'DELETE', { ids: selected });
      setToast({ msg: response.jsonMessage, type: 'ok' });
      setSelected([]);
      await search(last);
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  }

  const detail: any[] = [
    { key: 'select', label: '', filter: 'none', render: (row: any) => <input aria-label={`Select ${row.awbNo}`} type="checkbox" disabled={row.status === 'Issued'} checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /> },
    { key: 'awbNo', label: 'AWB No', filterAction: (value: string, setValue: (value: string) => void) => { setMultiText(value.split(',').join('\n')); setMultiApply(() => setValue); setMultiOpen(true); } },
    { key: 'locationName', label: 'Site Location', filter: 'select', options: (meta.locations || []).map((row: string[]) => row[1]) },
    { key: 'orderType', label: 'Order Type', filter: 'select', options: ['Prepaid', 'Normal', 'COD'] },
    { key: 'status', label: 'Status', filter: 'select', options: ['Free', 'Issued'] },
    { key: 'awbSearchTransporter', label: 'Transporter', filter: 'select', options: (meta.transporters || []).map((row: string[]) => row[1]) },
  ];
  const summaryColumns: any[] = [
    { key: 'awbSearchTransporter', label: 'Transporter' }, { key: 'locationName', label: 'Site Location' },
    { key: 'orderType', label: 'Order Type' }, { key: 'status', label: 'Status' },
    { key: 'awbNo', label: 'Total AWB', filter: 'none' },
  ];

  return <Shell active="wms" breadcrumb="WMS > Logistics > Manage AWB" openScreens={[{ label: editor ? 'AWB Create/Import' : 'Manage AWB', to: '#' }]}>
    {!editor ? <>
      <div className="mb-2 flex gap-2"><Btn variant={!summary ? 'primary' : 'ghost'} onClick={() => { setSummary(false); resetEnquiry(); }}>Detail</Btn><Btn variant={summary ? 'primary' : 'ghost'} onClick={() => { setSummary(true); resetEnquiry(); }}>Summary</Btn></div>
      <EnquiryScreen sectionTitle="Manage AWB" breadcrumb={[{ label: 'WMS' }, { label: 'Logistics' }, { label: 'Manage AWB' }]} cols={summary ? summaryColumns : detail} rows={rows} loading={loading} remote={pager} onSearch={search} onReset={resetEnquiry} actions={[
        { label: 'Export', icon: Download, onClick: () => setToast({ msg: rows.length ? 'Export requires report configuration.' : 'No Data to Export.', type: 'err' }) },
        { label: 'Delete', icon: Trash2, onClick: () => void deleteSelected() },
        { label: 'Add New', icon: Plus, onClick: () => setEditor(true) },
      ]} />
      {!rows.length && !loading && <p className="mt-3 rounded border bg-white p-4 text-sm text-slate-600">No AWB records yet. Add an AWB after creating a location and transporter.</p>}
    </> : <>
      <div className="mb-3 flex justify-end gap-2"><Btn onClick={() => void saveAwb()}>Save</Btn><Btn variant="ghost" onClick={() => setForm({ ...fresh })}>Reset</Btn></div>
      <Panel title="AWB Create/Import"><div className="grid gap-3 md:grid-cols-4">
        <Select label="Site Location *" value={form.siteLocCode} options={meta.locations || []} onChange={value => setForm({ ...form, siteLocCode: value })} />
        <Select label="Transporter *" value={form.transporterCode} options={[['-1', '--- Select ---'], ...(meta.transporters || [])]} onChange={value => setForm({ ...form, transporterCode: value })} />
        <Select label="Order Type *" value={form.orderType} options={meta.orderTypes || []} onChange={value => setForm({ ...form, orderType: value })} />
        <Select label="Status" value={form.status} options={(meta.statuses || []).filter((row: string[]) => row[0] !== '-1')} onChange={value => setForm({ ...form, status: value })} />
        <div className="flex gap-6 md:col-span-4"><Radio label="Add Single AWB" checked={form.mode === 'single'} onChange={() => setForm({ ...form, mode: 'single' })} /><Radio label="Add AWB Series" checked={form.mode === 'series'} onChange={() => setForm({ ...form, mode: 'series' })} /></div>
        {form.mode === 'single' ? <Input label="AWB No." value={form.singleAwb} onChange={value => setForm({ ...form, singleAwb: value })} /> : <>
          <Input label="Prefix" value={form.prefix} onChange={value => setForm({ ...form, prefix: value })} />
          <Input label="From" value={form.fromAwb} onChange={value => setForm({ ...form, fromAwb: value })} />
          <Input label="To" value={form.toAwb} onChange={value => setForm({ ...form, toAwb: value })} />
          <Input label="Suffix" value={form.suffix} onChange={value => setForm({ ...form, suffix: value })} />
        </>}
      </div></Panel>
    </>}
    <Modal title="Multiple AWB Search" open={multiOpen} onClose={() => setMultiOpen(false)}><label className="text-xs text-slate-600">AWB Numbers<textarea aria-label="AWB Numbers" className="inp mt-1 min-h-60 font-mono" value={multiText} onChange={event => setMultiText(event.target.value)} /></label><p className="mt-2 text-xs text-slate-500">Maximum 500 AWB numbers, one per line.</p><div className="mt-4 flex justify-end gap-2"><Btn onClick={() => { const values = multiText.split(/\r?\n/).map(value => value.trim()).filter(Boolean); if (values.length > 500) return setToast({ msg: 'Max 500 Records Can Be Entered', type: 'err' }); multiApply?.(values.join(',')); setMultiOpen(false); }}>OK</Btn><Btn variant="ghost" onClick={() => setMultiOpen(false)}>Close</Btn></div></Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs">{label}<input aria-label={label} className="inp mt-1" value={value} onChange={event => onChange(event.target.value)} /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <label className="text-xs">{label}<select aria-label={label} className="inp mt-1" value={value} onChange={event => onChange(event.target.value)}><option value="">--- Select ---</option>{options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>; }
function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="flex gap-2 text-xs"><input aria-label={label} type="radio" checked={checked} onChange={onChange} />{label}</label>; }
