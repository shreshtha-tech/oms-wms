/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, RefreshCw, RotateCw, Upload, Download, Plus, HelpCircle,
  Home, ChevronRight, ChevronsLeft, ChevronLeft, ChevronsRight,
} from 'lucide-react';
import Shell from './Shell';
import Modal from '../components/Modal';
import { Toast } from './parts';
import { apiGet, apiSend } from '../lib/api';
import { useDownload } from '../context/DownloadContext';

// Brand → logo text/colour chip (stand-in for marketplace logos)
const BRAND_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  flipkart: { label: 'Flipkart', bg: '#2874f0', fg: '#fff' },
  amazon: { label: 'amazon', bg: '#ff9900', fg: '#111' },
  myntra: { label: 'MYNTRA', bg: '#ff3f6c', fg: '#fff' },
  shopify: { label: 'shopify', bg: '#95bf47', fg: '#fff' },
  trendyol: { label: 'trendyol', bg: '#f27a1a', fg: '#fff' },
  nykaa: { label: 'Nykaa', bg: '#fc2779', fg: '#fff' },
  ajio: { label: 'AJIO', bg: '#2d2d2d', fg: '#fff' },
  meesho: { label: 'meesho', bg: '#570d6b', fg: '#fff' },
  custom: { label: 'Custom', bg: '#e5e7eb', fg: '#6b7280' },
};

function BrandLogo({ brand }: { brand: string }) {
  const c = BRAND_CHIP[brand] || BRAND_CHIP.custom;
  return (
    <div className="flex h-9 w-16 items-center justify-center rounded border border-slate-200 bg-white">
      <span className="truncate px-1 text-[10px] font-bold" style={{ color: c.bg === '#e5e7eb' ? '#6b7280' : c.bg }}>{c.label}</span>
    </div>
  );
}

// Arrow-shaped green status tag (matches the screenshot's chevron badges)
function ArrowTag({ text, tone = 'green' }: { text: string; tone?: 'green' | 'red' }) {
  const bg = tone === 'green' ? '#3aa856' : '#e05252';
  return (
    <span className="relative inline-flex h-6 items-center pl-3 pr-4 text-xs font-semibold text-white" style={{ background: bg, clipPath: 'polygon(0 0, 88% 0, 100% 50%, 88% 100%, 0 100%, 8% 50%)' }}>
      {text}
    </span>
  );
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${dd}/${mm}/${yy} ${String(h).padStart(2, '0')}:${m} ${ap}`;
};

export default function ManageChannels() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // search fields
  const initialFilters = { channel_code: '', channel_name: '', client_id: '', status: 'All', channel_type: '', brand_code: '', location: '', fulfilment_status: 'All', channel_group_code: '' };
  const [f, setF] = useState(initialFilters);

  const emptyForm = { channel_code: '', channel_name: '', brand: 'custom', channel_type: 'Custom Channel', location: '', status: 'Active', fulfilment_status: 'Online', channel_configured: 'No', client_id: '', auto_range: 'No', channel_sla: '48', process_future_order: '', customer_code: '', tax_calculation: '', pickup_slot: '', order_sync: 'No', order_sync_from_date: '', order_sync_from_order_no: '', shipping_by: 'Ship By Seller', invoice_no_by: 'Self', prepack_enabled: 'No', ready_to_ship_at: 'Manifest', each_qty_per_line: 'No', return_order_sync: 'No', return_sync_from_date: '', marketplace_invoice: 'No', marketplace_shipping_label: 'No', enable_return_push: 'No', push_item_cancel: 'No', update_invoice_on_manifest: 'Yes', transporter_wise_manifest: 'Yes', enable_otp_cnc: 'Yes', create_rto: 'Yes', restrict_unpack: 'No', inventory_sync: '', inventory_min_buffer: '', max_allowed_inventory: '', sync_method: '', inventory_percentage: '', sku_pull_push: '', sku_create_mode: '', address1: '', address2: '', address3: '', pin_code: '', phone: '', gst_tin: '', country: '', state: '', city: '' };
  const [form, setForm] = useState<any>(emptyForm);

  const search = async (nextPage = 1, nextSize = pageSize, filters = f) => {
    setLoading(true);
    try {
      const vnfDataString = JSON.stringify({ param3: filters.client_id || '-1', param1: filters.channel_code, param2: filters.channel_name, param4: filters.status === 'All' ? '-1' : filters.status === 'Active' ? '1' : '0', param5: filters.channel_type, param8: filters.brand_code, param7: filters.fulfilment_status === 'All' ? '-1' : filters.fulfilment_status === 'Online' ? '1' : '0', param17: filters.channel_group_code });
      const result: any = await apiSend('/api/channels', 'POST', { vnfDataString, key: 'CHANNELENQUIRYSEARCH', REQ_SEARCH_FLAG: true, rows: nextSize, page: nextPage, sidx: '', sord: 'desc', param6: filters.location, doFetchCount: false });
      setRows(result.commonSearchDTOList || result.gridModel || result.rows || []); setPage(result.page || nextPage); setPageSize(nextSize); setRecords(result.records || 0); setTotalPages(result.total || 0);
    } catch (error: any) { setRows([]); setToast({ msg: error.message || 'Failed to load channels', type: 'err' }); } finally { setLoading(false); }
  };
  useEffect(() => { void search(1, 20, initialFilters); }, []);
  useEffect(() => {
    void apiGet<any[]>('/api/clients').then(setClients).catch(() => {
      setToast({ msg: 'Unable to load configured clients', type: 'err' });
    });
    void apiGet<{ rows: any[] }>('/api/locations').then(data => setLocations(data.rows || [])).catch(() => {
      setToast({ msg: 'Unable to load configured locations', type: 'err' });
    });
  }, []);

  const pageRows = rows;
  const allChecked = pageRows.length > 0 && pageRows.every((r) => selected.includes(r.id));

  const doSearch = () => { void search(1); };
  const doReset = () => { setF(initialFilters); setSelected([]); void search(1, pageSize, initialFilters); };

  const toggle = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(allChecked ? selected.filter((id) => !pageRows.some((r) => r.id === id)) : [...new Set([...selected, ...pageRows.map((r) => r.id)])]);

  const exportData = (detail: boolean) => requestDownload({
    title: detail ? 'Channel Detail Export' : 'Channel Enquiry', module: 'channels', baseName: detail ? 'channel-detail' : 'channels',
    data: {
      columns: detail
        ? ['Channel Code', 'Channel Name', 'Brand', 'Channel Type', 'Fulfilment Status', 'Status', 'Location', 'Brand Code', 'Registration Date', 'Channel Configured']
        : ['Channel Code', 'Channel Name', 'Fulfilment Status', 'Status', 'Location', 'Registration Date', 'Channel Configured'],
      rows: rows.map((r) => detail
        ? [r.channel_code, r.channel_name, r.brand, r.channel_type, r.fulfilment_status, r.status, r.location, r.brand_code, fmtDate(r.registration_date), r.channel_configured]
        : [r.channel_code, r.channel_name, r.fulfilment_status, r.status, r.location, fmtDate(r.registration_date), r.channel_configured]),
    },
  });

  const addChannel = async () => {
    if (!form.channel_code.trim() || !form.channel_name.trim()) return setToast({ msg: 'Channel Code and Channel Name are required', type: 'err' });
    setSaving(true);
    try {
      await apiSend('/api/channels', 'POST', { ...form, registration_date: new Date().toISOString() });
      setToast({ msg: 'Channel added successfully', type: 'ok' }); setShowAdd(false); setForm(emptyForm); void search(1);
      if (form.brand === 'ajio') navigate('/app/fulfillment/ajio');
      if (form.brand === 'amazon') navigate('/app/fulfillment/amazon-mfn');
    } catch { setToast({ msg: 'Failed to add channel', type: 'err' }); } finally { setSaving(false); }
  };

  const abtn = 'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition';

  return (
    <Shell active="sales" breadcrumb="SALES > Manage Channels" openScreens={[{ label: 'Manage Channels', to: '#' }]}>
      {/* Breadcrumb + action toolbar */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <Home size={14} /> Channel Enquiry <ChevronRight size={13} className="text-slate-300" /> <span className="font-medium text-slate-700">Channel Enquiry</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={doSearch} className={`${abtn} bg-[#f5a623] text-white hover:brightness-105`}><Search size={14} /> Search</button>
          <button onClick={doReset} className={`${abtn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><X size={14} /> Reset</button>
          <button disabled title="No verified provider inventory readback job is connected" className={`${abtn} cursor-not-allowed bg-slate-300 text-slate-600`}><RotateCw size={14} /> Reconcile Inv</button>
          <button disabled title="No verified provider inventory sync job is connected" className={`${abtn} cursor-not-allowed bg-slate-300 text-slate-600`}><RefreshCw size={14} /> Synchronize 0 Inv</button>
          <button onClick={() => navigate('/app/admin/common-import')} className={`${abtn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Upload size={14} /> Import</button>
          <button onClick={() => exportData(false)} className={`${abtn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Download size={14} /> Export</button>
          <button onClick={() => exportData(true)} className={`${abtn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Download size={14} /> Detail Export</button>
          <button onClick={() => setShowMarketplace(true)} className={`${abtn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Plus size={14} /> Add New</button>
          <button onClick={() => setToast({ msg: 'Channel Enquiry searches and exports channel metadata. Live feed setup is managed in Seller Connections.', type: 'ok' })} className="rounded-full p-1 text-[#3b8fc4] hover:bg-slate-100" title="Help"><HelpCircle size={18} /></button>
        </div>
      </div>
      <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <span>Channel records store ERP metadata. Live inventory sync needs verified seller access, SKU/location mappings, and provider readback.</span>
        <button className="font-medium underline" onClick={() => navigate('/app/central-inventory?section=channels')}>Open Seller Connections</button>
      </div>

      {/* Search panel */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-slate-500">Search</p>
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-2">
          <Field label="Channel Code"><input value={f.channel_code} onChange={(e) => setF({ ...f, channel_code: e.target.value })} className="ci" /></Field>
          <Field label="Channel Name"><input value={f.channel_name} onChange={(e) => setF({ ...f, channel_name: e.target.value })} className="ci" /></Field>
          <Field label="Client"><select aria-label="Client" className="ci" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}><option value="">--- Select ---</option>{clients.map((client) => { const id = String(client.client_id ?? client.id ?? ''); const name = String(client.client_name ?? client.name ?? ''); return id && name ? <option key={id} value={id}>{id}-{name}</option> : null; })}</select></Field>
          <Field label="Brand Code"><input value={f.brand_code} onChange={(e) => setF({ ...f, brand_code: e.target.value })} className="ci" /></Field>
          <Field label="Location"><select aria-label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className="ci"><option value="">--- Select ---</option>{locations.map((location) => { const name = String(location.location_name ?? location.name ?? ''); const code = String(location.location_code ?? location.code ?? ''); return code && name ? <option key={code} value={name}>{code}-{name}</option> : null; })}</select></Field>
          <Field label="Status">
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="ci"><option>All</option><option>Active</option><option>InActive</option></select>
          </Field>
          <Field label="Channel Type"><select value={f.channel_type} onChange={(e) => setF({ ...f, channel_type: e.target.value })} className="ci"><option value="">- - - - - - - - - - -All- - - - - - - - - - -</option>{['AJIO B2C','AJIO Business','AJIO JIT','Amazon FBA India','Amazon Flex India','Amazon India','Amazon SC EasyShip','Amazon SPAPI IND','Custom Channel','Custom Inventory Channel','Flipkart V3(Multi WH)','Myntra B2B (JIT/FBM)','Nykaa Fashion','Shopify IN'].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Fulfilment Status">
            <select value={f.fulfilment_status} onChange={(e) => setF({ ...f, fulfilment_status: e.target.value })} className="ci"><option>All</option><option>Online</option><option>Offline</option></select>
          </Field>
          <Field label="Channel Group Code"><input value={f.channel_group_code} onChange={(e) => setF({ ...f, channel_group_code: e.target.value })} className="ci" /></Field>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 bg-slate-50 text-slate-600">
              <th className="w-10 px-3 py-3"><input type="checkbox" className="accent-[#2f9e9e]" checked={allChecked} onChange={toggleAll} /></th>
              <th className="w-20 px-3 py-3">Client</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Channel Code</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Channel Name</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Fulfilment Status</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Status</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Location</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Channel Type</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Registration Date</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Channel Configured</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">OrgId</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Last Recon Run Date</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Reconcile</th>
              <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={14} className="px-4 py-16 text-center text-slate-400"><div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#2f9e9e]" /><p className="mt-2 text-xs">Loading channels…</p></td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-16 text-center text-sm text-slate-400">No channels found</td></tr>
            ) : pageRows.map((r, i) => (
              <tr key={r.id} className={`${i % 2 ? 'bg-slate-50/60' : 'bg-white'} hover:bg-[#eef7fb]`}>
                <td className="px-3 py-2.5"><input type="checkbox" className="accent-[#2f9e9e]" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-3 py-2 text-center text-slate-600">{r.client || 'Default-0'}</td>
                <td className="px-3 py-2.5 text-center"><button onClick={() => { if (r.brand === 'ajio') navigate('/app/fulfillment/ajio'); if (r.brand === 'amazon') navigate('/app/fulfillment/amazon-mfn'); }} className="font-semibold text-[#2f7fb6] hover:underline">{r.channel_code}</button></td>
                <td className="px-3 py-2.5 text-slate-700">{r.channel_name}</td>
                <td className="px-3 py-2.5 text-center"><ArrowTag text={r.fulfilment_status} tone={r.fulfilment_status === 'Online' ? 'green' : 'red'} /></td>
                <td className="px-3 py-2.5 text-center"><ArrowTag text={r.status} tone={r.status === 'Active' ? 'green' : 'red'} /></td>
                <td className="px-3 py-2.5 text-center">{r.location === 'View Location(s)' ? <button className="font-medium text-[#2f7fb6] hover:underline">View Location(s)</button> : <span className="text-slate-700">{r.location}</span>}</td>
                <td className="px-3 py-2.5 text-center text-slate-700">{r.channel_type}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{fmtDate(r.registration_date)}</td>
                <td className="px-3 py-2.5 text-center text-slate-700">{r.channel_configured}</td>
                <td className="px-3 py-2.5 text-center text-slate-700">{r.org_id || 'USPL'}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{r.last_recon_run_date ? fmtDate(r.last_recon_run_date) : ''}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{r.reconcile || ''}</td>
                <td className="px-3 py-2.5 text-center text-red-600">{r.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          <div className="flex items-center gap-1">
            <PgBtn onClick={() => void search(1)} disabled={page === 1}><ChevronsLeft size={15} /></PgBtn>
            <PgBtn onClick={() => void search(Math.max(1, page - 1))} disabled={page === 1}><ChevronLeft size={15} /></PgBtn>
            <span className="mx-2 flex items-center gap-1">Page <input value={records ? page : 0} onChange={(e) => { const v = Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)); void search(v); }} className="w-12 rounded border border-slate-300 px-2 py-1 text-center" /> of {totalPages}</span>
            <PgBtn onClick={() => void search(Math.min(totalPages, page + 1))} disabled={!records || page === totalPages}><ChevronRight size={15} /></PgBtn>
            <PgBtn onClick={() => void search(totalPages)} disabled={!records || page === totalPages}><ChevronsRight size={15} /></PgBtn>
            <select aria-label="Records per Page" value={pageSize} onChange={(e) => { const size = Number(e.target.value); void search(1, size); }} className="ml-2 rounded border border-slate-300 px-2 py-1">
              {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <span>{records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : 'No records to view'}</span>
        </div>
      </div>

      <Modal title="Channel Create/Edit" open={showMarketplace} onClose={() => setShowMarketplace(false)} wide>
        <div className="max-h-[65vh] space-y-5 overflow-y-auto p-1">
          {[
            ['Select Marketplace to Integrate', [['Aceturtle OMS','custom'],['AJIO B2C','ajio'],['AJIO Business','ajio'],['AJIO JIT','ajio'],['Amazon FBA India','amazon'],['Amazon Flex India','amazon'],['Amazon SC EasyShip','amazon'],['Amazon Smart (Flex)','amazon'],['Amazon SmartBiz','amazon'],['Amazon SPAPI IND','amazon'],['Blinkit','custom'],['Custom Inventory Channel','custom'],['Flipkart V3(Multi WH)','flipkart'],['Myntra B2B (JIT/FBM)','myntra'],['Nykaa Fashion','nykaa']]],
            ['Select Cart to Integrate', [['Amazon MCF Shopify','amazon'],['BigCommerce','custom'],['Custom Channel','custom'],['Endless Aisle','custom'],['Magento','custom'],['Shopify IN','shopify'],['Shopify UK','shopify'],['Shopify US','shopify'],['WooCommerce','custom']]],
            ['Select International Marketplace to Integrate', [['Amazon FBA (UAE)','amazon'],['Amazon FBA UK','amazon'],['Amazon FBA US','amazon'],['Amazon SPAPI Australia','amazon'],['Amazon SPAPI Japan','amazon'],['Amazon SPAPI UAE','amazon'],['Ebay UK','custom'],['Ebay US','custom'],['Meesho','meesho'],['Shopee(India) V2','custom'],['TIKTOK(UK) V2','custom']]],
          ].map(([heading, choices]: any) => <section key={heading}><h3 className="mb-3 bg-[#2585ad] px-3 py-1.5 text-center text-base text-white">{heading}</h3><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{choices.map(([name, brand]: string[]) => <button key={name} onClick={() => { setShowMarketplace(false); setForm({ ...emptyForm, channel_name: name, channel_type: name, brand }); setShowAdd(true); }} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded border bg-white p-3 text-xs font-semibold text-slate-600 hover:border-[#3b8fc4]"><BrandLogo brand={brand}/>{name}</button>)}</div></section>)}
        </div>
      </Modal>

      {/* Add New modal */}
      <Modal title="Channel Maintenance" open={showAdd} onClose={() => setShowAdd(false)} wide>
        <div className="mb-4 flex gap-4 border-b text-sm font-medium text-[#2f7fb6]"><span className="border-b-2 border-[#2f7fb6] pb-2">Channel Maintenance</span><span>User Defined Field</span><button className="ml-auto pb-2" onClick={() => setToast({ msg: 'Live API credentials and feed verification are managed in Seller Connections; this screen stores channel metadata.', type: 'ok' })}>Configure Interface</button></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Channel Code</label><input value={form.channel_code} onChange={(e) => setForm({ ...form, channel_code: e.target.value })} className="inp" placeholder="e.g. ABX" /></div>
          <div><label className="lbl">Channel Name</label><input value={form.channel_name} onChange={(e) => setForm({ ...form, channel_name: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Brand</label><select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="inp">{Object.keys(BRAND_CHIP).map((b) => <option key={b} value={b}>{BRAND_CHIP[b].label}</option>)}</select></div>
          <div><label className="lbl">Channel Type</label><select value={form.channel_type} onChange={(e) => setForm({ ...form, channel_type: e.target.value })} className="inp"><option>Marketplace</option><option>Webstore</option><option>Custom Channel</option><option>POS</option></select></div>
          <div><label className="lbl">Location</label><select aria-label="Channel Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="inp"><option value="">--- Select ---</option>{locations.map((location) => { const name = String(location.location_name ?? location.name ?? ''); const code = String(location.location_code ?? location.code ?? ''); return code && name ? <option key={code} value={name}>{code}-{name}</option> : null; })}</select></div>
          <div><label className="lbl">Fulfilment Status</label><select value={form.fulfilment_status} onChange={(e) => setForm({ ...form, fulfilment_status: e.target.value })} className="inp"><option>Online</option><option>Offline</option></select></div>
          <div><label className="lbl">Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="inp"><option>Active</option><option>InActive</option></select></div>
          <div><label className="lbl">Channel Configured</label><select disabled value="No" className="inp"><option>No</option></select><small className="text-xs text-slate-500">This changes only after seller access and inventory readback are verified in Seller Connections.</small></div>
          <div><label className="lbl">Client</label><select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className="inp"><option value="">--- Select ---</option>{clients.map((client) => { const id = String(client.client_id ?? client.id ?? ''); const name = String(client.client_name ?? client.name ?? ''); return id && name ? <option key={id} value={id}>{id}-{name}</option> : null; })}</select></div>
          <div><label className="lbl">Auto Range SKU</label><select value={form.auto_range} onChange={(e) => setForm({ ...form, auto_range: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">Channel SLA</label><input type="number" min="0" value={form.channel_sla} onChange={(e) => setForm({ ...form, channel_sla: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Process Future Order</label><input type="number" min="0" value={form.process_future_order} onChange={(e) => setForm({ ...form, process_future_order: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Tax Calculation</label><select value={form.tax_calculation} onChange={(e) => setForm({ ...form, tax_calculation: e.target.value })} className="inp"><option value="">--- Select ---</option><option>Tax Inclusive</option><option>Tax Exclusive</option></select></div>
          <div><label className="lbl">Order Sync</label><select value={form.order_sync} onChange={(e) => setForm({ ...form, order_sync: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          {form.order_sync === 'Yes' && <><div><label className="lbl">Order Sync From Date</label><input value={form.order_sync_from_date} onChange={(e) => setForm({ ...form, order_sync_from_date: e.target.value })} className="inp" /></div><div><label className="lbl">Sync From Order No</label><input value={form.order_sync_from_order_no} onChange={(e) => setForm({ ...form, order_sync_from_order_no: e.target.value })} className="inp" /></div></>}
          <div><label className="lbl">Shipping By</label><select value={form.shipping_by} onChange={(e) => setForm({ ...form, shipping_by: e.target.value })} className="inp"><option>Ship By Seller</option></select></div>
          <div><label className="lbl">Invoice No By</label><select value={form.invoice_no_by} onChange={(e) => setForm({ ...form, invoice_no_by: e.target.value })} className="inp"><option>Self</option></select></div>
          <div><label className="lbl">PrePack Enabled</label><select value={form.prepack_enabled} onChange={(e) => setForm({ ...form, prepack_enabled: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">Mark Ready To Ship At</label><select value={form.ready_to_ship_at} onChange={(e) => setForm({ ...form, ready_to_ship_at: e.target.value })} className="inp"><option>Manifest</option><option>Pack</option></select></div>
          <div><label className="lbl">Each Qty Per Line</label><select value={form.each_qty_per_line} onChange={(e) => setForm({ ...form, each_qty_per_line: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">Return Order Sync</label><select value={form.return_order_sync} onChange={(e) => setForm({ ...form, return_order_sync: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          {form.return_order_sync === 'Yes' && <div><label className="lbl">Return Sync From Date</label><input value={form.return_sync_from_date} onChange={(e) => setForm({ ...form, return_sync_from_date: e.target.value })} className="inp" /></div>}
          <div><label className="lbl">Marketplace Invoice</label><select value={form.marketplace_invoice} onChange={(e) => setForm({ ...form, marketplace_invoice: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">Marketplace Shipping Label</label><select value={form.marketplace_shipping_label} onChange={(e) => setForm({ ...form, marketplace_shipping_label: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">SKU Pull / Push</label><select value={form.sku_pull_push} onChange={(e) => setForm({ ...form, sku_pull_push: e.target.value })} className="inp"><option value="">--- Select ---</option><option>Pull</option><option>Push</option></select></div>
          <div><label className="lbl">SKU Create Mode</label><select value={form.sku_create_mode} onChange={(e) => setForm({ ...form, sku_create_mode: e.target.value })} className="inp"><option value="">--- Select ---</option><option>Create</option><option>Moderate</option></select></div>
          <div><label className="lbl">Inventory Sync</label><select value={form.inventory_sync} onChange={(e) => setForm({ ...form, inventory_sync: e.target.value })} className="inp"><option value="">--- Select ---</option><option>No</option><option>Yes</option></select></div>
          <div><label className="lbl">Sync Method</label><select value={form.sync_method} onChange={(e) => setForm({ ...form, sync_method: e.target.value })} className="inp"><option value="">--- Select ---</option><option>ALL</option><option>Custom</option></select></div>
          <div><label className="lbl">Channel Inventory Percentage</label><input type="number" min="0" max="100" value={form.inventory_percentage} onChange={(e) => setForm({ ...form, inventory_percentage: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Address 1</label><input value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Pin Code</label><input value={form.pin_code} onChange={(e) => setForm({ ...form, pin_code: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="inp" /></div>
          <div><label className="lbl">GST/TIN No.</label><input value={form.gst_tin} onChange={(e) => setForm({ ...form, gst_tin: e.target.value })} className="inp" /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShowAdd(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => { setShowAdd(false); setShowMarketplace(true); }} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600">Add New</button>
          <button onClick={addChannel} disabled={saving} className="rounded-md bg-[#2f9e9e] px-4 py-2 text-sm font-medium text-white hover:brightness-105 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 shrink-0 text-right text-sm text-slate-500">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}
function PgBtn({ children, onClick, disabled }: { children: any; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40">{children}</button>;
}
