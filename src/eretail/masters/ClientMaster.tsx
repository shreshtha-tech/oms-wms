/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Download, Plus, RotateCcw, Save, Search, X } from 'lucide-react';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import { Btn, Toast } from '../parts';
import { apiForm, apiSend } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';
import { sellerCountries as COUNTRIES } from '../sales/sellerPanelCatalogs';
import { transporterStates as STATES } from './transporterCatalogs';
import { partnerCurrencies } from './partnerCurrencies';

const sizes = [20, 50, 100, 200];
const cls = 'w-full border border-slate-300 bg-white px-2 py-1.5 text-xs';
const blankFilters = { client_id: '-1', client_name: '', client_short_name: '', status: '', country: '', state: '-1', city: '' };
const initial: any = {
  client_name: '', client_id: '', client_short_name: '', status: '-1', client_currency: '-1', billing_required: false,
  ext_client_code: '', address1: '', address2: '', contact_person: '', phone: '', email: '', country: '', state: '', city: '', pincode: '',
  udf1: '', udf2: '', udf3: '', udf4: '', udf5: '', invoice_report: '-1', label_report: '-1',
  total_shelf_life: '', shelf_life_receiving: '', shelf_life_picking: '', location_links: [], users: [],
};
const tabs = ['Client Master', 'User Defined Fields', 'Client Location Link', 'User Creation', 'Other Settings'];

export default function ClientMaster() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState(blankFilters);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [tab, setTab] = useState('Client Master');
  const [form, setForm] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<any>(null);

  const search = async (nextPage = 1, nextSize = pageSize, nextFilters = filters) => {
    setLoading(true);
    try {
      const result: any = await apiForm('/api/jsonClientMasterEnquirySearch', {
        _search: true, nd: Date.now(), rows: nextSize, page: nextPage, sidx: 'clientId', sord: 'desc',
        clientId: nextFilters.client_id || '-1', clientName: nextFilters.client_name, clientShortName: nextFilters.client_short_name,
        status: nextFilters.status, country: nextFilters.country, state: nextFilters.state || '-1', city: nextFilters.city,
        REQ_SEARCH_FLAG: true, doFetchCount: false,
      });
      setRows(result.gridModel || []);
      setPage(result.page || nextPage);
      setPageSize(nextSize);
      setRecords(result.records || 0);
      setTotal(result.total || 0);
    } catch (error: any) {
      setRows([]); setRecords(0); setTotal(0);
      setNotice({ msg: error.message || 'Unable to search clients.', type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFilters(blankFilters); setRows([]); setRecords(0); setTotal(0);
    setTimeout(() => document.querySelector<HTMLSelectElement>('[aria-label="Client ID"]')?.focus());
  };
  const openNew = () => { setEditing(null); setForm({ ...initial }); setTab('Client Master'); setShow(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ ...initial, ...row, status: row.status === 'Active' ? '1' : '0' });
    setTab('Client Master');
    setShow(true);
  };

  const save = async () => {
    const checks: [string, string][] = [
      ['client_name', 'Client Name is mandatory.'], ['client_id', 'Client ID is mandatory.'],
      ['client_short_name', 'Client Short Name is mandatory.'], ['status', 'Status is mandatory.'],
      ['client_currency', 'Client Currency is mandatory.'], ['address1', 'Address1 is mandatory.'], ['phone', 'Phone is mandatory.'],
    ];
    for (const [key, message] of checks) {
      if (!String(form[key] ?? '').trim() || form[key] === '-1') {
        setNotice({ msg: message, type: 'err' }); setTab('Client Master');
        setTimeout(() => document.querySelector<HTMLElement>(`[data-client-field="${key}"]`)?.focus());
        return;
      }
    }
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
      setNotice({ msg: 'Wrong Email.', type: 'err' }); setTab('Client Master');
      setTimeout(() => document.querySelector<HTMLElement>('[data-client-field="email"]')?.focus());
      return;
    }
    for (const [key, message] of [['country', 'Country is mandatory.'], ['state', 'State is mandatory.'], ['city', 'City is mandatory.'], ['pincode', 'Pin Code is mandatory.']] as [string, string][]) {
      if (!String(form[key] ?? '').trim() || form[key] === '-1') {
        setNotice({ msg: message, type: 'err' }); setTab('Client Master');
        setTimeout(() => document.querySelector<HTMLElement>(`[data-client-field="${key}"]`)?.focus());
        return;
      }
    }
    if (form.shelf_life_receiving && !/^\d+$/.test(form.shelf_life_receiving)) {
      setNotice({ msg: 'Shelf Life Receiving must be an integer value', type: 'err' }); setTab('Other Settings'); return;
    }
    setBusy(true);
    try {
      await apiSend('/api/clients', editing ? 'PUT' : 'POST', editing ? { ...form, id: editing.id } : form);
      setNotice({ msg: editing ? 'Client updated successfully' : 'Client created successfully', type: 'ok' });
      setShow(false);
      void search(page);
    } catch (error: any) {
      setNotice({ msg: error.message, type: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const download = () => rows.length
    ? requestDownload({ title: 'Client Master', module: 'clients', baseName: 'ClientEnquiry', data: { columns: ['Client ID', 'Client Name', 'Client Short Name', 'Status', 'Country', 'State', 'City'], rows: rows.map(row => [row.client_id, row.client_name, row.client_short_name, row.status, row.country, row.state, row.city]) } })
    : setNotice({ msg: 'No data found in the grid to export.', type: 'err' });

  const unavailableChildTab = tab === 'Client Location Link' || tab === 'User Creation';
  return <Shell active="master" breadcrumb="MASTER > Trading Partner > Client Master" openScreens={[{ label: 'Client Master', to: '#' }]}>
    <div className="mb-2 flex justify-end gap-2">
      <Btn variant="warn" disabled={loading} onClick={() => void search(1)}><Search size={13} />Search</Btn>
      <Btn variant="ghost" onClick={reset}><RotateCcw size={13} />Reset</Btn>
      <Btn variant="ghost" onClick={openNew}><Plus size={13} />Add New</Btn>
      <Btn variant="ghost" onClick={download}><Download size={13} />Download</Btn>
    </div>
    <div className="overflow-auto border bg-white"><table className="min-w-[950px] w-full text-xs">
      <thead className="bg-slate-100"><tr>{['Client ID', 'Client Name', 'Client Short Name', 'Status', 'Country', 'State', 'City'].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr>
        <tr>
          <th className="p-1"><select aria-label="Client ID" className={cls} value={filters.client_id} onChange={event => setFilters({ ...filters, client_id: event.target.value })}><option value="-1">--- Select ---</option></select></th>
          <th className="p-1"><input aria-label="Client Name" className={cls} value={filters.client_name} onChange={event => setFilters({ ...filters, client_name: event.target.value })} /></th>
          <th className="p-1"><input aria-label="Client Short Name" className={cls} value={filters.client_short_name} onChange={event => setFilters({ ...filters, client_short_name: event.target.value })} /></th>
          <th className="p-1"><select aria-label="Status" className={cls} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">--- Select ---</option><option>InActive</option><option>Active</option></select></th>
          <th className="p-1"><select aria-label="Country" className={cls} value={filters.country} onChange={event => setFilters({ ...filters, country: event.target.value })}>{COUNTRIES.map((value, index) => <option key={`${value}-${index}`} value={index ? value : ''}>{value}</option>)}</select></th>
          <th className="p-1"><select aria-label="State" className={cls} value={filters.state} onChange={event => setFilters({ ...filters, state: event.target.value })}><option value="-1">--- Select ---</option></select></th>
          <th className="p-1"><input aria-label="City" className={cls} value={filters.city} onChange={event => setFilters({ ...filters, city: event.target.value })} /></th>
        </tr>
      </thead>
      <tbody>{loading ? <tr><td colSpan={7} className="p-12 text-center">Loading...</td></tr> : rows.length ? rows.map(row => <tr key={row.id} className="border-t"><td className="p-2"><button className="text-sky-600" onClick={() => openEdit(row)}>{row.client_id}</button></td><td>{row.client_name}</td><td>{row.client_short_name}</td><td>{row.status}</td><td>{row.country}</td><td>{row.state}</td><td>{row.city}</td></tr>) : <tr><td colSpan={7} className="p-12 text-center text-slate-400">No records to view</td></tr>}</tbody>
    </table><div className="flex justify-between border-t p-2 text-xs"><span>Page {records ? page : 0} of {total}</span><span><button disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button> <select aria-label="Records per Page" value={pageSize} onChange={event => void search(1, Number(event.target.value))}>{sizes.map(size => <option key={size}>{size}</option>)}</select> <button disabled={!records || page >= total} onClick={() => void search(page + 1)}>Next</button></span><span>{records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : 'No records to view'}</span></div></div>

    <Modal title="Client Create/Edit" open={show} onClose={() => setShow(false)} wide>
      <div className="mb-3 flex justify-end gap-2"><Btn variant="ghost" onClick={openNew}><Plus size={13} />Add New</Btn><Btn disabled={busy || unavailableChildTab} title={unavailableChildTab ? 'Client child-record APIs are not connected' : undefined} onClick={save}><Save size={13} />{busy ? 'Saving...' : 'Save'}</Btn></div>
      <div className="-mx-6 mb-3 flex overflow-auto border-b px-6">{tabs.map(name => <button key={name} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs ${tab === name ? 'border-sky-600' : ''}`} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tab === 'Client Master' && <div className="grid grid-cols-3 gap-3">
        {([['client_name', 'Client Name', 50], ['client_id', 'Client ID', 10], ['client_short_name', 'Client Short Name', 10]] as [string, string, number][]).map(([key, label, max]) => <L key={key} label={label}><input data-client-field={key} maxLength={max} className={cls} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></L>)}
        <L label="Status"><select data-client-field="status" className={cls} value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="-1">--- Select ---</option><option value="0">InActive</option><option value="1">Active</option></select></L>
        <L label="Client Currency"><select data-client-field="client_currency" className={cls} value={form.client_currency} onChange={event => setForm({ ...form, client_currency: event.target.value })}><option value="-1">--- Select ---</option>{partnerCurrencies.filter(value => value && value !== '--- Select ---').map(value => <option key={value}>{value}</option>)}</select></L>
        <L label="Is Billing Required"><input type="checkbox" checked={!!form.billing_required} onChange={event => setForm({ ...form, billing_required: event.target.checked })} /></L>
        <L label="Ext Client Code"><input maxLength={50} className={cls} value={form.ext_client_code} onChange={event => setForm({ ...form, ext_client_code: event.target.value })} /></L>
        <div className="col-span-3 border-b pt-2 text-xs font-semibold">Address</div>
        {([['address1', 'Address1', 50], ['address2', 'Address2', 50], ['contact_person', 'Contact Person', 50], ['phone', 'Phone', 20], ['email', 'Email', 50]] as [string, string, number][]).map(([key, label, max]) => <L key={key} label={label}><input data-client-field={key} maxLength={max} className={cls} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></L>)}
        <L label="Country"><select data-client-field="country" className={cls} value={form.country} onChange={event => setForm({ ...form, country: event.target.value })}>{COUNTRIES.map((value, index) => <option key={`${value}-${index}`} value={index ? value : ''}>{value}</option>)}</select></L>
        <L label="State"><select data-client-field="state" className={cls} value={form.state} onChange={event => setForm({ ...form, state: event.target.value })}><option value="">---Select State ---</option>{STATES.map((value, index) => <option key={`${value}-${index}`}>{value}</option>)}</select></L>
        {([['city', 'City', 50], ['pincode', 'Pincode', 10]] as [string, string, number][]).map(([key, label, max]) => <L key={key} label={label}><input data-client-field={key} maxLength={max} className={cls} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></L>)}
      </div>}
      {tab === 'User Defined Fields' && <div className="grid grid-cols-3 gap-3">{['Spare part', 'Item Details', 'UDF 3', 'UDF 4', 'UDF 5'].map((label, index) => <L key={label} label={label}><input maxLength={50} className={cls} value={form[`udf${index + 1}`]} onChange={event => setForm({ ...form, [`udf${index + 1}`]: event.target.value })} /></L>)}</div>}
      {tab === 'Client Location Link' && <ChildGrid kind="location" />}
      {tab === 'User Creation' && <ChildGrid kind="user" />}
      {tab === 'Other Settings' && <div className="grid grid-cols-3 gap-3">
        <L label="Invoice Report"><select disabled title="No client invoice report catalog is connected" className={cls} value={form.invoice_report}><option value="-1">--- Select ---</option></select></L>
        <L label="Label Report"><select disabled title="No client label report catalog is connected" className={cls} value={form.label_report}><option value="-1">--- Select ---</option></select></L>
        {([['total_shelf_life', 'Total Shelf Life'], ['shelf_life_receiving', 'Shelf Life on Receiving (No. of Days)'], ['shelf_life_picking', 'Shelf Life on Picking']] as [string, string][]).map(([key, label]) => <L key={key} label={label}><input maxLength={4} className={cls} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></L>)}
        <p role="status" className="col-span-3 text-xs text-amber-800">Invoice and label report selectors need configured report catalogs before they can be used.</p>
      </div>}
      <div className="mt-4 flex justify-end border-t pt-3"><Btn variant="ghost" onClick={() => setShow(false)}><X size={13} />Close</Btn></div>
    </Modal>
    {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
  </Shell>;
}

function L({ label, children }: { label: string; children: any }) {
  return <label className="text-xs text-slate-600">{label}{children}</label>;
}

function ChildGrid({ kind }: { kind: 'location' | 'user' }) {
  const headers = kind === 'location'
    ? ['Location Code - Name', 'Ext. Location Code', 'Status', 'Return Address1', 'Return Address2', 'Pincode']
    : ['User Id', 'First Name *', 'Last Name *', 'Email ID', 'Phone', 'Status'];
  const addLabel = kind === 'location' ? 'Add New Location' : 'Add New';
  return <div>
    <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      {kind === 'location' ? 'Client location links are unavailable because no client-location link API is connected.' : 'Client user creation is unavailable because no client-user provisioning API is connected.'}
    </div>
    <div className="mb-2"><Btn variant="ghost" disabled title="Client child-record API is not connected"><Plus size={13} />{addLabel}</Btn></div>
    <div className="overflow-auto border"><table className="min-w-[850px] w-full text-xs"><thead className="bg-slate-100"><tr>{headers.map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr><tr>{headers.map((label, index) => <th key={label} className="p-1">{(kind === 'location' && index === 0) || index === headers.length - 1 ? <select aria-label={`${kind} ${label} filter`} disabled className={cls}><option>--- Select ---</option></select> : <input aria-label={`${kind} ${label} filter`} disabled className={cls} />}</th>)}</tr></thead><tbody><tr><td colSpan={headers.length} className="p-8 text-center text-slate-400">No records to view</td></tr></tbody></table><div className="flex justify-between border-t p-2 text-xs"><span>Page of 0</span><select disabled aria-label="Records per Page"><option>20</option><option>50</option><option>100</option><option>200</option></select><span>No records to view</span></div></div>
  </div>;
}
