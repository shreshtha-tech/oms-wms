import { useEffect, useState } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { apiGet, apiSend } from '../../lib/api';
import EnquiryScreen from '../EnquiryScreen';
import Shell from '../Shell';
import { Btn, Panel, Toast } from '../parts';

const fresh: any = { id: null, siteLocCode: '-1', transporterCode: '-1', orderTypeCode: '-1', courierTypeCode: '-1', pinCode: '', embargoStart: '', embargoEnd: '', areaCode: '', slaDays: '' };
const initialFilters = { siteLocName: '' };

export default function ServicePinCodes() {
  const [rows, setRows] = useState<any[]>([]), [meta, setMeta] = useState<any>({});
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false), [editor, setEditor] = useState(false), [advanced, setAdvanced] = useState(false);
  const [form, setForm] = useState({ ...fresh }), [selected, setSelected] = useState<number[]>([]);
  const [last, setLast] = useState<any>(initialFilters), [toast, setToast] = useState<any>(null);

  useEffect(() => { apiGet('/api/service-pin-codes').then(setMeta).catch((e) => setToast({ msg: e.message, type: 'err' })); }, []);

  async function search(f: any = initialFilters, page = 1, size = pager.pageSize) {
    setLast(f); setLoading(true);
    try {
      const r: any = await apiSend('/api/service-pin-codes', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, rows: size, page, sidx: 'areapinmapPK.pinCode', sord: 'asc',
        transporter: f.transporter || '', orderType: f.orderType || '', siteLocCode: f.siteLocName || initialFilters.siteLocName,
        fromEmbargoStartDate: f.displayFromEmbargoStartDate || '', toEmbargoStartDate: '',
        fromEmbargoEndDate: f.displayFromEmbargoEndDate || '', toEmbargoEndDate: '', pinCode: f.pinCode || '',
        areaCode: f.areaCode || '', courierType: f.courierType || '', sellerPinCode: f.sellerPinCode || '', slaDays: f.slaDays || '',
      });
      setRows(r.gridModel || []); setPager({ page: r.page, total: r.total, records: r.records, pageSize: r.rows }); setSelected([]);
    } catch (e: any) {
      setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: size }); setToast({ msg: e.message, type: 'err' });
    } finally { setLoading(false); }
  }

  function resetEnquiry() { setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: 20 }); setSelected([]); setLast(initialFilters); }
  const open = (r?: any) => { setForm(r ? { ...fresh, ...r, embargoStart: r.displayFromEmbargoStartDate, embargoEnd: r.displayFromEmbargoEndDate } : { ...fresh }); setEditor(true); };

  async function save() {
    try {
      const loc = meta.locations?.find((x: any) => x[0] === form.siteLocCode)?.[1], tr = meta.transporters?.find((x: any) => x[0] === form.transporterCode)?.[1];
      const r: any = await apiSend('/api/service-pin-codes', form.id ? 'PUT' : 'POST', { ...form, siteLocName: loc, transporterName: tr });
      setToast({ msg: r.jsonMessage, type: 'ok' }); setEditor(false); await search(last);
    } catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function del() {
    if (!selected.length) { setToast({ msg: 'Please select Pin Code for delete', type: 'err' }); return; }
    if (!window.confirm('Do you really want to delete?')) return;
    try { const r: any = await apiSend('/api/service-pin-codes', 'DELETE', { ids: selected }); setToast({ msg: r.jsonMessage, type: 'ok' }); await search(last); }
    catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  const cols: any[] = [
    { key: 'pinCode', label: 'Pin Code', render: (r: any) => <button className="font-semibold text-sky-700" onClick={() => open(r)}>{r.pinCode}</button> },
    { key: 'siteLocName', label: 'Location', filter: 'select', options: (meta.locations || []).map((x: any) => x[1]) },
    { key: 'displayFromEmbargoStartDate', label: 'Embargo Start Date' }, { key: 'displayFromEmbargoEndDate', label: 'Embargo End Date' },
    { key: 'areaCode', label: 'Area Code' }, { key: 'orderType', label: 'Order Type', filter: 'select', options: ['COD', 'Prepaid'] },
    { key: 'courierType', label: 'Courier Type', filter: 'select', options: ['Forward', 'Reverse'] },
    { key: 'transporter', label: 'Transporter', filter: 'select', options: (meta.transporters || []).slice(1).map((x: any) => x[1]) },
    { key: 'slaDays', label: 'SLA (in days)' },
  ];
  const fields = advanced ? [{ key: 'sellerPinCode', label: 'Seller PinCode' }] : [];

  return <Shell active="wms" breadcrumb="WMS > Logistics > Manage Service Pin Code" openScreens={[{ label: editor ? 'Pin Code Add' : 'Manage Service Pin Code', to: '#' }]}>
    {!editor ? <EnquiryScreen sectionTitle="Manage Service Pin Code" breadcrumb={[{ label: 'WMS' }, { label: 'Logistics' }, { label: 'Manage Service Pin Code' }]}
      cols={cols} fields={fields} rows={rows} loading={loading} remote={pager} initialFilters={initialFilters}
      selectedIds={selected} onSelectionChange={setSelected} onSearch={search} onReset={resetEnquiry} actionsBeforeResetCount={1}
      actions={[{ label: 'Advance Search', onClick: () => setAdvanced(!advanced) }, { label: 'Import', icon: Upload, onClick: () => location.assign('/app/m/bulk-upload') },
        { label: 'Export', icon: Download, onClick: () => setToast({ msg: rows.length ? 'Pin code export prepared' : 'No data found', type: rows.length ? 'ok' : 'err' }) },
        { label: 'Delete', icon: Trash2, onClick: () => void del() }, { label: 'Add New', icon: Plus, onClick: () => open() }]} /> : <>
      <div className="mb-3 flex justify-end gap-2"><Btn onClick={() => void save()}>Save</Btn><Btn variant="ghost" onClick={() => setForm({ ...fresh })}>Reset</Btn><Btn variant="ghost" onClick={() => setEditor(false)}>Close</Btn></div>
      <Panel title="Pin Code Add"><div className="grid gap-3 md:grid-cols-3">
        <Sel l="Location" v={form.siteLocCode} o={[["-1", "--- Select ---"], ...(meta.locations || [])]} set={(v: any) => setForm({ ...form, siteLocCode: v })} />
        <Sel l="Courier Type*" v={form.courierTypeCode} o={meta.courierTypes} set={(v: any) => setForm({ ...form, courierTypeCode: v })} />
        <Sel l="Transporter*" v={form.transporterCode} o={meta.transporters} set={(v: any) => setForm({ ...form, transporterCode: v })} />
        <Sel l="Order Type*" v={form.orderTypeCode} o={meta.orderTypes} set={(v: any) => setForm({ ...form, orderTypeCode: v })} />
        <Inp l="Pin Code*" v={form.pinCode} set={(v: any) => setForm({ ...form, pinCode: v })} />
        <Inp l="Embargo Start Date" type="date" v={form.embargoStart} set={(v: any) => setForm({ ...form, embargoStart: v })} />
        <Inp l="Embargo End Date" type="date" v={form.embargoEnd} set={(v: any) => setForm({ ...form, embargoEnd: v })} />
        <Inp l="Area Code" v={form.areaCode} set={(v: any) => setForm({ ...form, areaCode: v })} /><Inp l="SLA (in days)" v={form.slaDays} set={(v: any) => setForm({ ...form, slaDays: v })} />
      </div></Panel>
    </>}{toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}

function Inp({ l, v, set, type = 'text' }: any) { return <label className="text-xs">{l}<input aria-label={l} className="inp mt-1" type={type} value={v} onChange={(e) => set(e.target.value)} /></label>; }
function Sel({ l, v, o = [], set }: any) { return <label className="text-xs">{l}<select aria-label={l} className="inp mt-1" value={v} onChange={(e) => set(e.target.value)}>{o.map(([a, b]: any) => <option key={a} value={a}>{b}</option>)}</select></label>; }
