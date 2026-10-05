import { useEffect, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Shell from '../Shell';
import EnquiryScreen, { ECol } from '../EnquiryScreen';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';
import { useDownload } from '../../context/DownloadContext';

export default function LocationEnquiry() {
  const navigate = useNavigate(), { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]), [meta, setMeta] = useState<any>({ hierarchy: [], locationTypes: [], hierarchyTypes: [], statuses: [], locationTags: [] }), [loading, setLoading] = useState(false), [advanced, setAdvanced] = useState(false), [tags, setTags] = useState<string[]>([]), [filters, setFilters] = useState<Record<string,string>>({}), [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 15 }), [toast, setToast] = useState<any>(null);
  useEffect(() => { apiGet('/api/locations').then(setMeta).catch(() => setToast({ msg: 'Failed to load location filters', type: 'err' })); }, []);
  const search = async (next = filters, page = 1, size = pager.pageSize) => { setLoading(true); try { const result: any = await apiSend('/api/locations', 'POST', { _search: true, rows: size, page, sidx: 'locCode', sord: 'desc', locationCode: next.location_code || '', locationName: next.location_name || '', locationShortName: next.location_short_name || '', locationType: next.location_type || '-1', sourceWarehouse: next.source_warehouse || '-1', hierarchyCode: next.hierarchy_code || '-1', hierarchyType: next.hierarchy_type || '-1', status: next.status || '-1', locationTag: tags.join(','), REQ_SEARCH_FLAG: true, locationList: "'UWH'" }); setRows(result.rows || []); setPager({ page: result.page || page, total: result.total || 0, records: result.records || 0, pageSize: size }); setFilters(next); } catch { setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: size }); setToast({ msg: 'Location search failed', type: 'err' }); } finally { setLoading(false); } };
  const reset = () => { setTags([]); setFilters({}); setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: 15 }); };
  const cols: ECol[] = [
    { key: 'location_code', label: 'Location Code', filter: 'text', sortable: true, align: 'left' }, { key: 'location_name', label: 'Location Name', filter: 'text', align: 'left' }, { key: 'location_short_name', label: 'Short Name', filter: 'text', align: 'left' },
    { key: 'location_type', label: 'Location Type', filter: 'select', options: meta.locationTypes, align: 'left' }, { key: 'source_warehouse', label: 'Source Warehouse', filter: 'select', options: meta.rows?.map((row:any) => row.location_name) || [], align: 'left' },
    { key: 'hierarchy_code', label: 'Hierarchy Code', filter: 'select', options: meta.hierarchy?.map((row:any) => row.code) || [], align: 'left' }, { key: 'hierarchy_type', label: 'Hierarchy Type', filter: 'select', options: meta.hierarchyTypes, align: 'left' }, { key: 'status', label: 'Status', filter: 'select', options: meta.statuses, align: 'left' },
  ];
  const exportRows = () => { if (!rows.length) return setToast({ msg: 'No data found in grid to export.', type: 'err' }); requestDownload({ title: 'Location Enquiry', module: 'location', baseName: 'location-enquiry', data: { columns: cols.map((col) => col.label), rows: rows.map((row) => cols.map((col) => row[col.key])) } }); };
  return <Shell active="master" breadcrumb="MASTER > Organization Management > Location Enquiry" openScreens={[{ label: 'Location Enquiry', to: '#' }]}>
    {advanced && <div className="mb-3 rounded border bg-white p-3"><label className="text-sm text-slate-600">Location Tag<select multiple value={tags} onChange={(e) => setTags(Array.from(e.target.selectedOptions, (option) => option.value))} className="inp mt-1 h-24">{meta.locationTags.map((tag:string) => <option key={tag}>{tag}</option>)}</select></label></div>}
    <EnquiryScreen breadcrumb={[{ label: 'Master' }, { label: 'Organization Management' }, { label: 'Location Enquiry' }]} cols={cols} rows={rows} loading={loading} emptyText="No records to view" onSearch={search} onReset={reset} remote={pager} pageSizes={[15,25,50,200]} actions={[{ label: 'Advance Search', onClick: () => setAdvanced(!advanced) }, { label: 'Export', icon: Download, onClick: exportRows }, { label: 'Add New', icon: Plus, onClick: () => navigate('/app/m/location-create') }]} onRowEdit={(row) => navigate(`/app/m/location-create?id=${row.id}`)} />
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
