/* eslint-disable @typescript-eslint/no-explicit-any -- Admin records have deliberately heterogeneous, recording-derived payloads. */
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, HelpCircle, Pencil, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import Shell from '../Shell';
import { apiGet, apiSend } from '../../lib/api';
import { RecordedAuditLogs, RecordedManageApi, RecordedUserEnquiry } from './RecordedAdminWorkflows';
import UserEditorReplica from './UserEditorReplica';
import RoleEditorReplica from './RoleEditorReplica';
import OrderImportReplica from './OrderImportReplica';
import CommonImportReplica from './CommonImportReplica';
import ExportsReplica from './ExportsReplica';
import ForceOrderPullReplica from './ForceOrderPullReplica';
import SettingsReplica from './SettingsReplica';
import AdminLogGrid from './AdminLogGrid';
import UserAuditLogReplica from './UserAuditLogReplica';
import LanguageSettingReplica from './LanguageSettingReplica';
import ManageApiReplica from './ManageApiReplica';
import ApiDashboardReplica from './ApiDashboardReplica';

type Row = Record<string, any> & { id: number; type: string; status?: string; version?: number };
type ToastState = { message: string; tone: 'success' | 'error' } | null;

const screenMeta: Record<string, { title: string; crumb: string }> = {
  'user-enquiry': { title: 'User Enquiry', crumb: 'Admin > User Management > User Enquiry' },
  'user-create-edit': { title: 'User Create/Edit', crumb: 'Admin > User Management > User Create/Edit' },
  'role-create-edit': { title: 'Role Create/Edit', crumb: 'Admin > User Management > Role Create/Edit' },
  'order-import': { title: 'Order Import', crumb: 'Admin > Imports > Order Import' },
  'common-import': { title: 'Common Import', crumb: 'Admin > Imports > Common Import' },
  exports: { title: 'Exports', crumb: 'Home > Pending Report' },
  'force-order-pull': { title: 'Force Order Pull', crumb: 'Admin > Force Order Pull' },
  settings: { title: 'Settings', crumb: 'Admin > Settings' },
  'manage-api': { title: 'Manage Api', crumb: 'Admin > Api > Manage Api' },
  'manage-api-edit': { title: 'Manage Api Add/Edit', crumb: 'Admin > Api > Manage Api Add/Edit' },
  'manage-api-webhook': { title: 'Register Webhook', crumb: 'Admin > Api > Manage Api Webhook' },
  'audit-logs': { title: 'Audit Logs', crumb: 'Admin > Audit Logs' },
  'user-audit-logs': { title: 'User Audit Logs', crumb: 'Admin > Logs > User Audit Logs' },
  'accounting-log': { title: 'Accounting Log', crumb: 'Admin > Logs > Accounting Log' },
  'tax-integration-log': { title: 'Tax Integration Log', crumb: 'Admin > Logs > Tax Integration Log' },
  'device-tracking-log': { title: 'Device Tracking Log', crumb: 'Admin > Logs > Device Tracking Log' },
  'external-apps-logs': { title: 'External Apps Logs', crumb: 'Admin > Logs > External Apps Logs' },
  'pos-integration-log': { title: 'POS Integration Log', crumb: 'Admin > Logs > POS Integration Log' },
  'repush-log': { title: 'Repush Log', crumb: 'Admin > Logs > Repush Log' },
  'language-setting': { title: 'Language Setting', crumb: 'Admin > Miscellaneous > Language Setting' },
  'api-dashboard': { title: 'API Dashboard', crumb: 'Admin > Api > API Dashboard' },
};

const input = 'h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:border-sky-500';
const label = 'whitespace-nowrap text-right text-sm text-slate-600';
const primary = 'inline-flex items-center gap-1.5 rounded bg-[#ec9818] px-3 py-2 text-sm font-medium text-white hover:bg-[#d98608] disabled:opacity-50';
const success = 'inline-flex items-center gap-1.5 rounded bg-[#0aad56] px-3 py-2 text-sm font-medium text-white hover:bg-[#069548] disabled:opacity-50';
const neutral = 'inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

function Toast({ toast, close }: { toast: ToastState; close: () => void }) {
  if (!toast) return null;
  return <div className={`fixed right-5 top-20 z-[100] flex min-w-72 items-center justify-between rounded border px-4 py-3 text-sm shadow-lg ${toast.tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}><span>{toast.message}</span><button onClick={close}><X size={15} /></button></div>;
}

function Grid({ columns, rows, empty = 'No records to view', actions }: { columns: { key: string; label: string; value?: (row: Row) => React.ReactNode }[]; rows: Row[]; empty?: string; actions?: (row: Row) => React.ReactNode }) {
  return <div className="overflow-hidden border border-slate-300 bg-white">
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-[#e9e8f3] text-slate-700"><tr>{columns.map((c) => <th key={c.key} className="border-r border-slate-300 px-3 py-1.5 text-center font-bold">{c.label}</th>)}{actions && <th className="px-3 py-1.5 text-center font-bold">Actions</th>}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id} className={index % 2 ? 'bg-[#f7f6fc]' : 'bg-white'}>{columns.map((c) => <td key={c.key} className="max-w-80 truncate border-t border-slate-200 px-3 py-1.5 text-center text-slate-700">{c.value ? c.value(row) : row[c.key] || ''}</td>)}{actions && <td className="border-t border-slate-200 px-3 py-1 text-center">{actions(row)}</td>}</tr>)}</tbody>
      </table>
    </div>
    <div className="flex h-8 items-center justify-between bg-[#e9e8f3] px-3 text-xs text-slate-500"><span>◀ ◀ Page <b>1</b> of {Math.max(1, Math.ceil(rows.length / 20))} ▶ ▶ <select className="ml-2 border border-slate-300 bg-white px-1"><option>20</option><option>50</option><option>100</option></select></span><span>{rows.length ? `View 1 - ${Math.min(20, rows.length)} of ${rows.length}` : empty}</span></div>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-1 overflow-hidden rounded border border-slate-200 bg-white"><div className="flex items-center justify-between bg-[#f4f4f8] px-3 py-1 font-semibold text-slate-600"><span>{title}</span><span>−</span></div>{children}</section>;
}

function UserEnquiry({ openEditor }: { openEditor: () => void }) {
  const [rows, setRows] = useState<Row[]>([]); const [filter, setFilter] = useState({ username: '', firstName: '', lastName: '', status: '', email: '', userType: 'Normal' }); const [toast, setToast] = useState<ToastState>(null);
  const load = () => apiGet<Row[]>('/api/admin?type=user').then(setRows).catch(() => setToast({ message: 'Unable to load users', tone: 'error' }));
  useEffect(() => { void load(); }, []);
  const results = useMemo(() => rows.filter((r) => Object.entries(filter).every(([key, value]) => !value || String(r[key] || '').toLowerCase().includes(value.toLowerCase()))), [rows, filter]);
  const exportRows = () => {
    const csv = ['User Name,First Name,Last Name,Status,Email,User Type', ...results.map((r) => [r.username, r.firstName, r.lastName, r.status, r.email || '', r.userType || 'Normal'].join(','))].join('\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = href; a.download = 'user-enquiry.csv'; a.click(); URL.revokeObjectURL(href);
  };
  return <><div className="mb-3 flex justify-end gap-2"><button className={primary} onClick={load}><Search size={16} />Search</button><button className={neutral} onClick={() => setFilter({ username: '', firstName: '', lastName: '', status: '', email: '', userType: 'Normal' })}>✖ Reset</button><button className={neutral}>✥ Advance Search</button><button className={neutral}><Upload size={15} /> Import</button><button className={neutral} onClick={exportRows}><Download size={15} /> Export</button><button className={neutral} onClick={openEditor}><Plus size={15} /> Add New</button><HelpCircle className="mt-2 text-[#287cc0]" size={24} /></div>
    <Grid columns={[
      { key: 'username', label: 'User Name', value: (r) => r.username }, { key: 'firstName', label: 'First Name' }, { key: 'lastName', label: 'Last Name' }, { key: 'status', label: 'Status' }, { key: 'email', label: 'Email' }, { key: 'userType', label: 'User Type' },
    ]} rows={results} />
    <Toast toast={toast} close={() => setToast(null)} /></>;
}

function Field({ label: text, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="grid grid-cols-[150px_1fr] items-center gap-3"><span className={label}>{text}</span><input className={input} type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function SelectField({ label: text, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="grid grid-cols-[150px_1fr] items-center gap-3"><span className={label}>{text}</span><select className={input} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option} value={option === '--- Select ---' ? '' : option}>{option}</option>)}</select></label>; }

function ManageApi() {
  const [rows, setRows] = useState<Row[]>([]); const [editing, setEditing] = useState<Row | null>(null); const [toast, setToast] = useState<ToastState>(null);
  const load = () => apiGet<Row[]>('/api/admin?type=api-key').then(setRows).catch(() => setToast({ message: 'Unable to load API keys', tone: 'error' })); useEffect(() => { void load(); }, []);
  const add = () => setEditing({ id: 0, type: 'api-key', apiKey: crypto.randomUUID().replaceAll('-', ''), owner: '', timezone: '', billToParty: '', maskStatus: '', allowedIps: '', apiType: 'All', apiCategory: '', apiName: '', apiUrl: '', accessRights: false, keyForVinLister: false, status: 'Active', permissions: [] });
  const save = async () => { if (!editing) return; try { if (editing.id) await apiSend('/api/admin', 'PUT', editing); else await apiSend('/api/admin', 'POST', editing); setEditing(null); setToast({ message: 'API key saved successfully', tone: 'success' }); load(); } catch (e) { setToast({ message: e instanceof Error ? e.message : 'Unable to save API key', tone: 'error' }); } };
  if (editing) return <ApiEditor row={editing} setRow={setEditing} save={save} cancel={() => setEditing(null)} />;
  return <><div className="mb-3 flex justify-end gap-2"><button className={success} onClick={add}><Plus size={15} />Add</button><button className={neutral} onClick={load}><RefreshCw size={15} />Refresh</button><button className={neutral}>⚙ Register Webhook</button><HelpCircle className="mt-2 text-[#287cc0]" size={24} /></div><Grid rows={rows} columns={[{ key: 'apiKey', label: 'API Key' }, { key: 'owner', label: 'API Owner' }, { key: 'createdAt', label: 'Created Date', value: (r) => r.createdAt ? new Date(r.createdAt).toLocaleString() : '' }, { key: 'expiryDate', label: 'Expiry Date' }, { key: 'status', label: 'Status', value: (r) => <span className="inline-block bg-[#0aad56] px-4 py-0.5 text-white">{r.status || 'Active'}</span> }]} actions={(row) => <button onClick={() => setEditing(row)} className="text-[#ec9818]"><Pencil size={16} /></button>} /><Toast toast={toast} close={() => setToast(null)} /></>;
}

function ApiEditor({ row, setRow, save, cancel }: { row: Row; setRow: (row: Row) => void; save: () => void; cancel: () => void }) {
  const set = (key: string, value: any) => setRow({ ...row, [key]: value }); const permissions = (row.permissions || []) as Row[];
  return <><div className="mb-3 flex justify-end gap-2"><button className={primary} onClick={save}>Save</button><button className="inline-flex items-center gap-1.5 rounded bg-[#db2d3c] px-3 py-2 text-sm font-medium text-white" onClick={cancel}>⊗ Cancel</button></div><div className="space-y-2"><div className="grid grid-cols-2 gap-x-20 rounded border border-slate-200 bg-white p-4"><div className="space-y-3"><p className="text-sm"><b>API Key</b> {row.apiKey}</p><p className="text-sm"><b>API Owner</b> {row.owner || '—'}</p><SelectField label="Timezone" value={row.timezone || ''} onChange={(v) => set('timezone', v)} options={['--- Select ---', 'Asia/Kolkata', 'Asia/Jakarta']} /><Field label="isMonitor" value={row.isMonitor || ''} onChange={(v) => set('isMonitor', v)} /></div><div className="space-y-3"><SelectField label="Bill to Party" value={row.billToParty || ''} onChange={(v) => set('billToParty', v)} options={['--- Select ---', 'Enterprise', 'Company']} /><Field label="Mask Status" value={row.maskStatus || ''} onChange={(v) => set('maskStatus', v)} /><label className="grid grid-cols-[150px_1fr] items-start gap-3"><span className={label}>Allowed IPs</span><textarea className="h-14 w-full border border-slate-300 p-2 text-sm" value={row.allowedIps || ''} onChange={(e) => set('allowedIps', e.target.value)} /></label></div></div><div className="grid grid-cols-2 gap-x-20 rounded border border-slate-200 bg-white p-4"><div className="space-y-3"><SelectField label="API Type" value={row.apiType || 'All'} onChange={(v) => set('apiType', v)} options={['All', 'Inbound', 'Outbound']} /><SelectField label="API Name" value={row.apiName || ''} onChange={(v) => set('apiName', v)} options={['--- Select ---', 'Create Return', 'Order Cancellation', 'Order Create', 'Order Status Update', 'Return Update']} /><label className="ml-40 flex items-center gap-2 text-sm">Access Rights <input type="checkbox" checked={!!row.accessRights} onChange={(e) => set('accessRights', e.target.checked)} /></label></div><div className="space-y-3"><SelectField label="API Category" value={row.apiCategory || ''} onChange={(v) => set('apiCategory', v)} options={['--- Select ---', 'Order', 'Customer', 'Inventory']} /><Field label="API URL" value={row.apiUrl || ''} onChange={(v) => set('apiUrl', v)} /><label className="ml-40 flex items-center gap-2 text-sm">Key For Vin Lister <input type="checkbox" checked={!!row.keyForVinLister} onChange={(e) => set('keyForVinLister', e.target.checked)} /></label></div></div></div><Grid rows={permissions.map((permission, index) => ({ ...permission, id: index, type: 'permission' }))} columns={[{ key: 'name', label: 'API Name', value: (r) => r.name || row.apiName || '' }, { key: 'url', label: 'API URL', value: (r) => r.url || row.apiUrl || '' }, { key: 'rights', label: 'Access Rights', value: (r) => r.rights || (row.accessRights ? 'Yes' : 'No') }]} actions={() => <span className="text-[#ec9818]">✎ ▣</span>} /></>;
}

function ApiDashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiGet('/api/admin?action=dashboard').then(setData).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Unable to load API dashboard');
    });
  }, []);
  const cards = data?.cards;
  const metrics = [
    ['API Keys', cards?.apiKeys],
    ['Active API Keys', cards?.activeKeys],
    ['Force Pull Requests', cards?.pulls],
    ['Failed Imports', cards?.failedImports],
  ] as const;
  return <div className="space-y-4 rounded border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold">API Dashboard</h2>
    {error && <p role="alert" className="border border-rose-300 bg-rose-50 p-3 text-rose-700">{error}</p>}
    {cards && <section aria-label="API summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value]) => <article key={label} className="rounded border border-slate-200 p-4">
        <h3 className="text-sm text-slate-600">{label}</h3>
        <p className="mt-2 text-2xl font-semibold text-slate-800">{Number.isFinite(value) ? value : 0}</p>
      </article>)}
    </section>}
    {data && (data.topApis?.length || data.hits?.length)
      ? <p className="text-slate-600">API request activity is available in the recorded metrics.</p>
      : <div className="rounded border border-dashed border-slate-300 p-6 text-center text-slate-600">
        <p>No API request activity has been recorded.</p>
        <p className="mt-1 text-sm">Request metrics will appear after an integration records API activity.</p>
      </div>}
  </div>;
}

export default function AdminModule() {
  const { screen = 'user-enquiry' } = useParams(); const navigate = useNavigate(); const meta = screenMeta[screen] || screenMeta['user-enquiry'];
  const logScreens = new Set(['audit-logs', 'user-audit-logs', 'accounting-log', 'tax-integration-log', 'device-tracking-log', 'external-apps-logs', 'pos-integration-log', 'repush-log']);
  const content = screen === 'user-enquiry' ? <RecordedUserEnquiry /> : logScreens.has(screen) ? <RecordedAuditLogs /> : screen === 'user-create-edit' ? <UserEditorReplica /> : screen === 'role-create-edit' ? <RoleEditorReplica /> : screen === 'order-import' ? <OrderImportReplica /> : screen === 'common-import' ? <CommonImportReplica /> : screen === 'exports' ? <ExportsReplica /> : screen === 'force-order-pull' ? <ForceOrderPullReplica /> : screen === 'settings' ? <SettingsReplica /> : screen === 'manage-api' ? <RecordedManageApi /> : screen === 'api-dashboard' ? <ApiDashboard /> : screen === 'language-setting' ? <SettingsReplica /> : <SettingsReplica />;
  const scopedContent = screen === 'user-audit-logs' ? <UserAuditLogReplica /> : logScreens.has(screen) && screen !== 'audit-logs' ? <AdminLogGrid key={screen} screen={screen} /> : screen === 'language-setting' ? <LanguageSettingReplica /> : screen === 'api-dashboard' ? <ApiDashboardReplica /> : screen === 'manage-api' ? <ManageApiReplica /> : screen === 'manage-api-edit' ? <ManageApiReplica mode="edit" /> : screen === 'manage-api-webhook' ? <ManageApiReplica mode="webhook" /> : content;
  const parityScreen = ['exports','force-order-pull','user-audit-logs','language-setting','api-dashboard','manage-api','manage-api-edit','manage-api-webhook'].includes(screen) || (logScreens.has(screen) && screen !== 'audit-logs');
  return <Shell active="admin" breadcrumb={meta.crumb} openScreens={[{ label: meta.title, to: '#' }]}><div className="min-h-full text-[14px]" style={parityScreen ? {height:'100%'} : undefined}>{scopedContent}</div></Shell>;
}
