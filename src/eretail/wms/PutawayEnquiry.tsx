import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

const fd = (date: Date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const defaults = () => {
  const today = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    putAwayNo: '', status: '-1', createdDate: `${fd(from)} - ${fd(today)}`, confirmedDate: '', putAwayType: '-1',
    locationCode: '', inboundNo: '', sku: '', poNo: '', orderNo: '', fromBin: '', toBin: '', toZone: '', obCode: '', extAsn: '', fromLpn: '', toLpn: '',
  };
};
const field = 'h-7 w-full min-w-24 rounded border border-slate-300 bg-white px-1 text-xs';
const heads = ['PutAway No.', 'Status', 'Created Date', 'Confirmed Date', 'PutAway Type', 'Source Qty', 'Location Code'];
const unsupportedFilterKeys = new Set(['orderNo', 'toBin', 'toZone', 'obCode', 'toLpn']);

export default function PutawayEnquiry() {
  const nav = useNavigate();
  const [query] = useSearchParams();
  const id = query.get('putAwayNo');
  const inboundNo = query.get('inboundNo') || '';
  const editorId = id || (inboundNo ? 'new' : null);
  return <Shell active="wms" breadcrumb="WMS > Inbound > PutAway Enquiry" openScreens={[{ label: editorId ? `PutAway-${editorId}` : 'PutAway Enquiry', to: '#' }]}>
    {editorId ? <Editor id={editorId} initialInboundNo={inboundNo} /> : <Enquiry onOpen={value => nav(`/app/r/putaway-enquiry?putAwayNo=${encodeURIComponent(value)}`)} />}
  </Shell>;
}

function Enquiry({ onOpen }: { onOpen: (id: string) => void }) {
  const [meta, setMeta] = useState<any>({});
  const [filters, setFilters] = useState<any>(defaults());
  const [rows, setRows] = useState<any[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, size: 20 });
  const [toast, setToast] = useState<any>(null);
  const [metaError, setMetaError] = useState('');

  useEffect(() => {
    void apiGet('/api/putaway-enquiry').then(setMeta).catch((error: any) => setMetaError(error.message));
  }, []);

  const search = async (page = 1, size = pager.size) => {
    if (!filters.createdDate && !filters.putAwayNo) return setToast({ msg: 'common.putAwayDateValid.message04', type: 'err' });
    const [fromCreatedDate, toCreatedDate] = String(filters.createdDate || '').split(' - ');
    try {
      const result: any = await apiSend('/api/putaway-enquiry', 'POST', {
        ...filters, CreatedDate: filters.createdDate, fromCreatedDate, toCreatedDate,
        rows: size, page, sidx: 'putAwayId', sord: 'desc', REQ_SEARCH_FLAG: true, doFetchCount: false,
      });
      setRows(result.putAwayList);
      setPager({ page: result.page, total: result.total, records: result.records, size });
    } catch (error: any) {
      setRows([]);
      setToast({ msg: error.message, type: 'err' });
    }
  };

  const filterFor = (heading: string) => {
    if (heading === 'PutAway No.') return <input aria-label="PutAway No." className={field} value={filters.putAwayNo} onChange={event => setFilters({ ...filters, putAwayNo: event.target.value })} />;
    if (heading === 'Status') return <select aria-label="Status" className={field} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>{(meta.statuses || []).map((item: any) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select>;
    if (heading === 'Created Date') return <input aria-label="Created Date" className={field} value={filters.createdDate} onChange={event => setFilters({ ...filters, createdDate: event.target.value })} />;
    if (heading === 'Confirmed Date') return <input aria-label="Confirmed Date" className={field} value={filters.confirmedDate} onChange={event => setFilters({ ...filters, confirmedDate: event.target.value })} />;
    if (heading === 'PutAway Type') return <select aria-label="PutAway Type" className={field} value={filters.putAwayType} onChange={event => setFilters({ ...filters, putAwayType: event.target.value })}>{(meta.types || []).map((item: any) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select>;
    if (heading === 'Location Code') return <select aria-label="Location Code" multiple className={field} value={filters.locationCode ? filters.locationCode.split('|') : []} onChange={event => setFilters({ ...filters, locationCode: [...event.target.selectedOptions].map(option => option.value).join('|') })}>{(meta.locations || []).map((item: any) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select>;
    return null;
  };

  const advancedFields: [string, string][] = [
    ['Inbound No.', 'inboundNo'], ['Confirmed Date', 'confirmedDate'], ['SKU', 'sku'], ['PO No.', 'poNo'], ['Order No.', 'orderNo'],
    ['From Bin', 'fromBin'], ['To Bin', 'toBin'], ['To Zone', 'toZone'], ['Ob Code', 'obCode'], ['Ext ASN No', 'extAsn'], ['From LPN', 'fromLpn'], ['To LPN', 'toLpn'],
  ];

  return <div className="border bg-white">
    <div role="status" className="m-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      PutAway records are drafts. Confirmation, bin suggestion, printing, and report exports are unavailable until placement and Central Inventory movement are connected.
    </div>
    {metaError && <div role="alert" className="m-3 text-sm text-red-700">Could not load PutAway search options: {metaError}</div>}
    <div className="flex justify-between border-b p-3"><div><b>WMS</b> <span className="text-slate-400">Inbound · PutAway Enquiry</span></div><div className="flex gap-2">
      <Btn variant="warn" onClick={() => void search()}>Search</Btn>
      <Btn variant="ghost" onClick={() => { setFilters(defaults()); setRows([]); }}>Reset</Btn>
      <Btn variant="ghost" onClick={() => setAdvanced(!advanced)}>Advance Search</Btn>
      <Btn variant="ghost" disabled title="Report generation is unavailable">Download</Btn>
      <Btn variant="ghost" disabled title="Report generation is unavailable">Detail Export</Btn>
      <Btn onClick={() => onOpen('new')}>Add New</Btn>
    </div></div>
    <div role="status" className="border-b px-3 pb-3 text-xs text-slate-600">Download and Detail Export are disabled because no PutAway report worker is connected.</div>
    {advanced && <fieldset className="m-3 grid grid-cols-4 gap-3 border p-3"><legend>Advance Search</legend>{advancedFields.map(([label, key]) => {
      const unavailable = unsupportedFilterKeys.has(key);
      return <label key={key} className="text-xs">{label}{unavailable && <span className="block text-amber-800">Unavailable until bin or order mappings are connected.</span>}<input aria-label={label} disabled={unavailable} className="inp mt-1" value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })} /></label>;
    })}</fieldset>}
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-slate-100"><tr>{heads.map(heading => <th className="border p-2 text-left" key={heading}>{heading}</th>)}</tr><tr>{heads.map(heading => <th className="border p-1" key={heading}>{filterFor(heading)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{[<button className="font-bold text-sky-700" onClick={() => onOpen(row.putAwayId)}>{row.putAwayId}</button>, row.status, row.createDate, row.confirmedDate, row.putAwayType, row.sourceQty, row.locCode].map((value, index) => <td className="border p-2" key={index}>{value}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="h-48 p-8 text-center text-sm text-slate-400">No records to view</div>}</div>
    <div className="flex justify-end gap-2 border-t p-2 text-xs"><button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>‹</button><span>Page {pager.records ? pager.page : ''} of {pager.total}</span><button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>›</button><select aria-label="Page size" value={pager.size} onChange={event => void search(1, +event.target.value)}>{[20, 50, 100, 200].map(size => <option key={size}>{size}</option>)}</select><span>{pager.records ? `View ${(pager.page - 1) * pager.size + 1} - ${Math.min(pager.page * pager.size, pager.records)} of ${pager.records}` : 'No records to view'}</span></div>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </div>;
}

function Editor({ id, initialInboundNo = '' }: { id: string; initialInboundNo?: string }) {
  const nav = useNavigate();
  const isNew = id === 'new';
  const [row, setRow] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [type, setType] = useState(initialInboundNo ? '5' : '-1');
  const [inbound, setInbound] = useState(initialInboundNo);
  const [mode, setMode] = useState(initialInboundNo ? '1' : '-1');
  const [qc, setQc] = useState<string[]>(['1']);
  const [remarks, setRemarks] = useState('');
  const [audit, setAudit] = useState(false);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    if (isNew) return;
    void apiGet<any>(`/api/putaway-enquiry?putAwayNo=${encodeURIComponent(id)}`).then(result => {
      setRow(result.row);
      setRemarks(result.row.remarks || '');
    }).catch((error: any) => setLoadError(error.message));
  }, [id, isNew]);

  const create = async () => {
    if (type === '-1') return setToast({ msg: 'Putaway Type is mandatory', type: 'err' });
    if (['2', '5'].includes(type) && !inbound.trim()) return setToast({ msg: 'Select atleast one inbound for putaway', type: 'err' });
    if (type === '5' && mode === '-1') return setToast({ msg: 'Putaway Mode is Mandatory', type: 'err' });
    if (type === '2' && !qc.length) return setToast({ msg: 'QC Status is Mandatory', type: 'err' });
    try {
      const result: any = await apiSend('/api/putaway-enquiry', 'POST', { action: 'create', type, inboundNo: inbound, mode, qcstatus: qc, remarks });
      nav(`/app/r/putaway-enquiry?putAwayNo=${encodeURIComponent(result.row.putAwayId)}`);
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    }
  };

  const act = async (action: 'save' | 'cancel') => {
    try {
      const result: any = await apiSend('/api/putaway-enquiry', 'POST', { action, putAwayId: id, remarks });
      setRow(result.row);
      setRemarks(result.row.remarks || '');
      setToast({ msg: action === 'cancel' ? 'PutAway draft cancelled' : 'PutAway draft remarks saved', type: 'ok' });
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    }
  };

  const selectedType = isNew ? type : ({ CancelledOrder: '1', 'Selected Inbound': '2', 'Selected Inbound RealTime': '5', 'User defined_Cancelled Order': '3' } as any)[row?.putAwayType?.trim()] || '5';
  return <div className="border bg-white">
    <div role="status" className="m-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Generated PutAway rows are drafts. Confirm, System Suggested routing, printing, report export, and stock movement are not connected.
    </div>
    <div className="flex justify-end gap-2 border-b p-3">{isNew ? <Btn variant="warn" onClick={() => void create()}>Generate PutAway</Btn> : <>
      <Btn variant="ghost" disabled title="Printing is unavailable">Print</Btn>
      {row?.status === 'Open' && <><Btn onClick={() => void act('save')}>Save</Btn><Btn disabled title="Bin placement and Central Inventory movement are not connected">Confirm</Btn><Btn variant="danger" onClick={() => void act('cancel')}>Cancel</Btn></>}
    </>}<Btn variant="ghost" onClick={() => nav('/app/r/putaway-enquiry?putAwayNo=new')}>Add New</Btn></div>
    <div role="status" className="border-b px-4 pb-3 text-xs text-slate-600">{isNew ? 'Generate creates a draft from a confirmed inbound receipt; it does not move stock.' : 'Save changes remarks only. Confirmation requires bin placement and a Central Inventory movement.'}</div>
    {loadError && <div role="alert" className="m-4 text-sm text-red-700">Could not load PutAway: {loadError}</div>}
    <div className="p-4"><h2 className="mb-4 font-semibold">PutAway</h2><div className="grid grid-cols-3 gap-3">
      <label className="text-xs">Putaway Type*<select aria-label="Putaway Type" disabled={!isNew} className="inp mt-1" value={selectedType} onChange={event => setType(event.target.value)}><option value="-1">--- Select ---</option><option value="1">Cancelled Order</option><option value="2">Selected Inbound</option><option value="5">Selected Inbound RealTime</option><option value="3">User defined_Cancelled Order</option></select></label>
      {['2', '5'].includes(selectedType) && <label className="text-xs">Inbound No*<input aria-label="Inbound No." disabled={!isNew} className="inp mt-1" value={isNew ? inbound : row?.inboundNo || ''} onChange={event => setInbound(event.target.value)} /></label>}
      {selectedType === '5' && <label className="text-xs">Putaway Mode*<select aria-label="Putaway Mode" disabled={!isNew} className="inp mt-1" value={mode} onChange={event => setMode(event.target.value)}><option value="-1">--- Select ---</option><option value="1">User Defined Putaway</option><option value="2" disabled>System Suggested Putaway (unavailable)</option></select><span className="block text-amber-800">System Suggested is unavailable until bin allocation is connected.</span></label>}
      <label className="text-xs">Remarks<textarea aria-label="Remarks" disabled={!isNew && row?.status !== 'Open'} className="inp mt-1" value={remarks} onChange={event => setRemarks(event.target.value)} /></label>
    </div>
    {row && <><table className="mt-5 w-full text-xs"><thead><tr>{['SKU Code', 'Inbound Detail', 'LPN', 'Lot', 'Suggested Bin', 'Qty For PutAway', 'Putaway Qty'].map(heading => <th className="border p-2" key={heading}>{heading}</th>)}</tr></thead><tbody>{row.details.map((detail: any, index: number) => <tr key={index}><td className="border p-2 text-sky-700">{detail.skuCode}</td><td className="border p-2">{detail.inboundNo} Line No {detail.lineNo}</td><td className="border p-2">{detail.lpn}</td><td className="border p-2">{detail.lot}</td><td className="border p-2">{detail.suggestedBin}</td><td className="border p-2">{detail.qty}</td><td className="border p-2">{detail.putawayQty}</td></tr>)}</tbody></table>
      <div className="mt-4 border p-3"><button className="font-semibold" onClick={() => setAudit(false)}>PutAway Detail</button><button className="ml-6 font-semibold" onClick={() => setAudit(true)}>Audit</button>{audit ? <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><span>Created By</span><b>{row.createdBy}</b><span>Created Date</span><b>{row.createDate}</b><span>Modified By</span><b>{row.modifiedBy}</b><span>Modified Date</span><b>{row.modifiedDate}</b></div> : <div className="mt-3 grid grid-cols-4 gap-2 text-sm"><span>Putaway No</span><b>{row.putAwayId}</b><span>Status</span><b>{row.status}</b><span>Total Items</span><b>{row.details.length}</b><span>Source Qty</span><b>{row.sourceQty}</b></div>}</div></>}
    </div>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </div>;
}
