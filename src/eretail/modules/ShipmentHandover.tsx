/* eslint-disable @typescript-eslint/no-explicit-any -- Manifest rows include variable delivery and transporter fields. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { apiGet, apiSend } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';
import EnquiryScreen from '../EnquiryScreen';
import Shell from '../Shell';
import { Btn, Panel, Toast } from '../parts';

type Pair = [string, string];
type Catalog = {
  locations: Pair[]; clients: Pair[]; transporters: Pair[];
  transporterTypes: Pair[]; transporterDetails: { code: string; type: string }[]; channelTypes: Pair[];
};
const emptyCatalog: Catalog = { locations: [], clients: [], transporters: [], transporterTypes: [], transporterDetails: [], channelTypes: [] };
const newManifest = () => ({
  id: null as number | null, delManifestNo: '', businessType: '0',
  transporterType: '-1', transporter: '-1', channelType: '-1',
  siteLocCode: '-1', clientId: '-1', vehicleNo: '', driverName: '',
  driverNumber: '', trackingNo: '', remarks: '', deliveries: [] as string[], status: 'Pending',
});
const manifestColumns = [
  ['delManifestNo', 'Manifest No'], ['manifestDate', 'Manifest Date'],
  ['transporter', 'Transporter'], ['status', 'Status'], ['siteLocName', 'Location'],
  ['clientId', 'Client'], ['channelType', 'Channel'], ['orderCount', 'Order Count'], ['recordTrust', 'Record Trust'],
] as const;

export default function ShipmentHandover() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Catalog>(emptyCatalog);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [editor, setEditor] = useState(false);
  const [form, setForm] = useState<any>(newManifest);
  const [selected, setSelected] = useState<string[]>([]);
  const [toast, setToast] = useState<any>(null);
  const [last, setLast] = useState<any>({ manifestNo: '', frmMnaifestDate: '' });

  useEffect(() => {
    void apiGet<Catalog>('/api/manage-manifests')
      .then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message, type: 'err' }))
      .finally(() => setCatalogLoaded(true));
  }, []);

  async function search(filters: any = {}, page = 1, size = pager.pageSize) {
    setLast(filters);
    setLoading(true);
    try {
      const result = await apiSend<any>('/api/manage-manifests', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, rows: size, page, sidx: 'CRTDate', sord: 'desc',
        manifestNo: filters.delManifestNo || filters.manifestNo || '',
        transporter: filters.transporter || '',
        frmMnaifestDate: filters.frmMnaifestDate || filters.manifestDate || '',
        toManifestDate: filters.toManifestDate || '', userId: filters.createdBy || '',
        trackingNo: filters.trackingNo || '', status: filters.status || '',
        deliveryNo: filters.deliveryNo || '', location: filters.siteLocCode || '-1',
        clientId: filters.clientId || '-1', channelType: filters.channelType || '-1',
        isB2B: filters.isB2BId || '-1', handoverId: filters.handoverId || '',
      });
      setRows(result.manifestDTOList);
      setPager({ page: result.page, total: result.total, records: result.records, pageSize: size });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Search failed', type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  function open(row?: any) {
    setForm(row ? { ...newManifest(), ...row, businessType: row.isB2BId || '0' } : newManifest());
    setSelected([]);
    setEditor(true);
  }

  function addDelivery(all = false) {
    const values = all ? String(form.trackingNo).split(/[\n,]/).map(value => value.trim()).filter(Boolean) : [String(form.trackingNo).trim()].filter(Boolean);
    if (!values.length) return setToast({ msg: 'Please Enter Delivery No/Tracking No', type: 'err' });
    setForm({ ...form, deliveries: [...new Set([...form.deliveries, ...values])], trackingNo: '' });
  }

  async function create() {
    try {
      const result = await apiSend<any>('/api/manage-manifests', 'POST', { ...form, action: 'draft-save' });
      setForm({ ...form, ...result.row, id: result.row.id });
      setToast({ msg: result.jsonMessage, type: 'ok' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Unable to save manifest', type: 'err' });
    }
  }

  async function act(action: string) {
    try {
      const result = await apiSend<any>('/api/manage-manifests', 'PUT', { id: form.id, action });
      setForm({ ...form, ...result.row });
      setToast({ msg: result.jsonMessage, type: 'ok' });
      await search(last);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Manifest action failed', type: 'err' });
    }
  }

  function exportRows(detail = false) {
    if (!rows.length) return setToast({ msg: 'No data found', type: 'err' });
    const columns = detail ? [...manifestColumns.map(([, label]) => label), 'Delivery/Tracking No'] : manifestColumns.map(([, label]) => label);
    const values = detail
      ? rows.flatMap(row => (row.deliveries?.length ? row.deliveries : ['']).map((delivery: string) => [...manifestColumns.map(([key]) => row[key] ?? ''), delivery]))
      : rows.map(row => manifestColumns.map(([key]) => row[key] ?? ''));
    requestDownload({ title: detail ? 'Manifest Detail Export' : 'Manifest Export', module: 'manage-manifests',
      baseName: detail ? 'manifest-details' : 'manifests', data: { columns, rows: values } });
  }

  function downloadManifest(print = false) {
    if (!form.id) return;
    requestDownload({
      title: `Manifest ${form.delManifestNo}`,
      module: 'manage-manifests', baseName: `manifest-${form.delManifestNo}`,
      formats: print ? ['pdf'] : ['pdf', 'csv'],
      data: { columns: ['Manifest No', 'Location', 'Transporter', 'Status', 'Delivery/Tracking No'],
        rows: form.deliveries.map((delivery: string) => [form.delManifestNo, form.siteLocName || '', form.transporter || '', form.status, delivery]) },
    });
  }

  const cols: any[] = [
    { key: 'clientId', label: 'Client', filter: 'select', options: meta.clients.map(([code]) => code) },
    { key: 'delManifestNo', label: 'Manifest No', render: (row: any) => <button className="text-sky-700 underline" onClick={() => open(row)}>{row.delManifestNo}</button> },
    { key: 'manifestDate', label: 'Manifest Date' },
    { key: 'transporter', label: 'Transporter', filter: 'select', options: meta.transporters.map(([, name]) => name) },
    { key: 'extTransporterName', label: 'Ext Transporter Name' }, { key: 'createdBy', label: 'User' },
    { key: 'status', label: 'Status', filter: 'select', options: ['Cancelled', 'Confirmed', 'Invoiced', 'InvoiceInProcess', 'Pending'] },
    { key: 'siteLocCode', label: 'Location', filter: 'select', options: meta.locations.map(([code]) => code) },
    { key: 'orderCount', label: 'Order Count', filter: 'none' },
    { key: 'print', label: 'Print', filter: 'none', render: (row: any) => <button className="text-sky-700 underline" onClick={() => { open(row); }} aria-label={`Open ${row.delManifestNo} for printing`}>Open</button> },
    { key: 'handoverId', label: 'HandoverId' }, { key: 'vehicleNo', label: 'vehicleNo', filter: 'none' },
    { key: 'remarks', label: 'Remarks', filter: 'none' },
    { key: 'isB2B', label: 'Order Processing', filter: 'select', options: ['B2C Flow', 'B2B Flow', 'Transhipment Flow'] },
  ];
  const fields: any[] = advanced ? [
    { key: 'deliveryNo', label: 'Delivery No' }, { key: 'trackingNo', label: 'Tracking No' },
    { key: 'channelType', label: 'Channel Type', type: 'select', options: ['--- Select ---', ...meta.channelTypes.map(([code]) => code)] },
    { key: 'toManifestDate', label: 'To Manifest Date' },
  ] : [{ key: 'manifestNo', label: 'Manifest No' }, { key: 'manifestDate', label: 'Manifest Date' }];

  return <Shell active="wms" breadcrumb="WMS > Order Processing > Manage Manifest" openScreens={[{ label: editor ? 'Generate Manifest' : 'Manage Manifest', to: '#' }]}>
    {catalogLoaded && !meta.locations.length && <div className="mb-3 flex items-center justify-between rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>No locations configured. Add a location before creating a manifest.</span>
      <button className="font-semibold underline" onClick={() => navigate('/app/m/location-create')}>Add location</button>
    </div>}
    {catalogLoaded && !meta.transporters.length && <div className="mb-3 flex items-center justify-between rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>No transporters configured. Add a transporter before creating a manifest.</span>
      <button className="font-semibold underline" onClick={() => navigate('/app/transporters')}>Add transporter</button>
    </div>}
    {!editor ? <EnquiryScreen sectionTitle="Manage Manifest" breadcrumb={[{ label: 'WMS' }, { label: 'Order Processing' }, { label: 'Manage Manifest' }]}
      cols={cols} fields={fields} rows={rows} loading={loading} remote={pager} onSearch={search}
      emptyText="No manifests found. Add a manifest after configuring a location and transporter."
      onReset={() => { setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: 20 }); setAdvanced(false); }}
      actionsBeforeResetCount={1}
      actions={[
        { label: 'Advance Search', onClick: () => setAdvanced(value => !value) },
        { label: 'Export', icon: Download, onClick: () => exportRows() },
        { label: 'Detail Export', icon: Download, onClick: () => exportRows(true) },
        { label: 'Add New', icon: Plus, onClick: () => open() },
      ]} /> : <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={() => setEditor(false)}>Cancel</Btn>
        <Btn variant="ghost" disabled={!form.id} onClick={() => downloadManifest(true)}>Print Manifest</Btn>
        <Btn variant="ghost" disabled={!form.id} onClick={() => downloadManifest()}>Download Manifest</Btn>
        <Btn variant="ghost" disabled title="Manifest lifecycle is not connected">ReOpen</Btn>
        <Btn variant="ghost" disabled title="Carrier dispatch is not connected">Manifested</Btn>
        <Btn disabled title="Central Inventory custody is not connected">Confirm Manifest</Btn>
        <Btn variant="ghost" disabled title="Carrier dispatch is not connected">Mark RFS</Btn>
      </div>
      <Panel title="Generate Manifest"><div role="status" className="mb-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Saving a manifest draft records local metadata only. Existing rows are labeled by record trust. Confirm, Mark RFS and Manifested are disabled until Central Inventory custody and a verified carrier dispatch connector are connected.</div>
        <div className="mb-4 flex gap-6 text-xs">
          <label><input type="radio" aria-label="MarketPlace" checked={form.businessType === '0'} onChange={() => setForm({ ...form, businessType: '0' })} /> MarketPlace</label>
          <label><input type="radio" aria-label="Self Ship" checked={form.businessType === '1'} onChange={() => setForm({ ...form, businessType: '1' })} /> Self Ship</label>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Location" value={form.siteLocCode} options={[['-1', '--- Select ---'], ...meta.locations]} set={value => setForm({ ...form, siteLocCode: value })} />
          <Select label="Client" value={form.clientId} options={[['-1', '--- Select ---'], ...meta.clients]} set={value => setForm({ ...form, clientId: value })} />
          <Select label="Transporter Type" value={form.transporterType} options={[['-1', '--- Select ---'], ...meta.transporterTypes]} set={value => setForm({ ...form, transporterType: value, transporter: '-1', transporterCode: '-1' })} />
          <Select label="Transporter" value={form.transporterCode || form.transporter} options={[['-1', '--- Select ---'], ...meta.transporters.filter(([code]) => form.transporterType === '-1' || meta.transporterDetails.some(detail => detail.code === code && detail.type === form.transporterType))]} set={value => setForm({ ...form, transporter: value, transporterCode: value })} />
          <Select label="Channel Type" value={form.channelType} options={[['-1', '--- Select ---'], ...meta.channelTypes]} set={value => setForm({ ...form, channelType: value })} />
          <Input label="Manifest No" value={form.delManifestNo} disabled />
          <Input label="Vehicle No" value={form.vehicleNo} set={value => setForm({ ...form, vehicleNo: value })} />
          <Input label="Driver Name" value={form.driverName} set={value => setForm({ ...form, driverName: value })} />
          <Input label="Driver Number" value={form.driverNumber} set={value => setForm({ ...form, driverNumber: value })} />
          <Input label="Scan Delivery No/Tracking No*" value={form.trackingNo} set={value => setForm({ ...form, trackingNo: value })} />
          <Input label="Remarks" value={form.remarks} set={value => setForm({ ...form, remarks: value })} />
        </div>
        <div className="mt-3 flex gap-2">
          <Btn onClick={() => addDelivery()}>Add</Btn>
          <Btn variant="danger" disabled={!selected.length} onClick={() => { setForm({ ...form, deliveries: form.deliveries.filter((value: string) => !selected.includes(value)) }); setSelected([]); }}>Remove</Btn>
          <Btn variant="ghost" onClick={() => { setForm({ ...form, trackingNo: '', deliveries: [] }); setSelected([]); }}>Reset</Btn>
          <Btn variant="ghost" onClick={() => addDelivery(true)}>Add all</Btn>
          <Btn variant="warn" disabled={Boolean(form.id)} onClick={() => void create()}>Save</Btn>
        </div>
        <table className="mt-4 w-full text-sm"><thead><tr><th className="w-12">Select</th><th>Delivery/Tracking No</th></tr></thead><tbody>{form.deliveries.map((value: string) => <tr key={value}>
          <td className="border-t p-2 text-center"><input aria-label={`Select ${value}`} type="checkbox" checked={selected.includes(value)} onChange={event => setSelected(event.target.checked ? [...selected, value] : selected.filter(item => item !== value))} /></td>
          <td className="border-t p-2 text-center">{value}</td>
        </tr>)}</tbody></table>
      </Panel>
    </>}
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}

function Input({ label, value, set = () => {}, disabled }: { label: string; value: string; set?: (value: string) => void; disabled?: boolean }) {
  return <label className="text-xs">{label}<input aria-label={label} className="inp mt-1" value={value || ''} disabled={disabled} onChange={event => set(event.target.value)} /></label>;
}

function Select({ label, value, options, set }: { label: string; value: string; options: Pair[]; set: (value: string) => void }) {
  return <label className="text-xs">{label}<select aria-label={label} className="inp mt-1" value={value || '-1'} onChange={event => set(event.target.value)}>{options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>;
}
