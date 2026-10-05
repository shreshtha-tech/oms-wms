/* eslint-disable @typescript-eslint/no-explicit-any -- Grading records and picker rows have distinct API shapes. */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDownload } from '../../context/DownloadContext';
import { apiGet, apiSend } from '../../lib/api';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';

const field = 'h-7 w-full min-w-24 rounded border border-slate-300 bg-white px-1 text-xs';
const formatDate = (date: Date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const defaultFilters = () => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 60);
  return { gradeId: '', inboundCode: '', crtDate: `${formatDate(start)} - ${formatDate(end)}`, status: '-1', locCode: '-1' };
};
const exportKeys: Record<string, string> = {
  GradeId: 'gradeId', 'Inbound No': 'inboundCode', Status: 'statusText',
  'Creation Date': 'crtDate', OrgId: 'orgId', locCode: 'locCode',
};

export default function SkuGrading() {
  const [params] = useSearchParams();
  const id = params.get('gradeId');
  return <Shell active="wms" breadcrumb="WMS > Miscellaneous > Sku Grading" openScreens={[{ label: id ? 'Sku Grade Maintenance' : 'Sku Grading', to: '#' }]}>
    {id ? <Editor id={id} /> : <Enquiry />}
  </Shell>;
}

function Enquiry() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [meta, setMeta] = useState<any>({ available: false });
  const [filters, setFilters] = useState(defaultFilters);
  const [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, size: 20 });
  const [exportOpen, setExportOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    void apiGet<any>('/api/sku-grading')
      .then(result => { setMeta(result); setFields(result.exportFields || []); })
      .catch((error: Error) => setToast({ msg: error.message, type: 'err' }));
  }, []);

  async function search(page = 1, size = pager.size) {
    const [fromCrtDate, toCrtDate] = filters.crtDate.split(' - ');
    try {
      const result = await apiSend<any>('/api/sku-grading', 'POST', {
        ...filters, fromCrtDate, toCrtDate, rows: size, page, REQ_SEARCH_FLAG: true,
      });
      setRows(result.gridModel);
      setPager({ page: result.page, total: result.total, records: result.records, size });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Search failed', type: 'err' });
    }
  }

  function exportRows() {
    if (!rows.length) return setToast({ msg: 'No data in grid to export', type: 'err' });
    setExportOpen(true);
  }

  function submitExport() {
    if (!fields.length) return setToast({ msg: 'No Data In Grid To Export', type: 'err' });
    requestDownload({
      title: 'SKU Grading Export', module: 'sku-grading', baseName: 'sku-grading',
      data: { columns: fields, rows: rows.map(row => fields.map(name => row[exportKeys[name]] ?? '')) },
    });
    setExportOpen(false);
  }

  const setFilter = (key: string, value: string) => setFilters(previous => ({ ...previous, [key]: value }));
  return <div className="border bg-white">
    <div className="flex justify-between border-b p-3"><h2 className="font-semibold">WMS Miscellaneous Sku Grading</h2><div className="flex gap-2">
      <Btn variant="warn" onClick={() => void search()}>Search</Btn>
      <Btn variant="ghost" onClick={() => { setFilters(defaultFilters()); setRows([]); setPager({ page: 1, total: 0, records: 0, size: 20 }); }}>Reset</Btn>
      <Btn variant="ghost" onClick={exportRows}>Export</Btn>
      <Btn onClick={() => navigate('/app/r/sku-grading?gradeId=new')}>Add New</Btn>
    </div></div>
    <table className="w-full text-xs"><thead className="bg-slate-100"><tr>{['Graded Id', 'Inbound No', 'Creation Date', 'Status', 'Location'].map(title => <th className="border p-2 text-left" key={title}>{title}</th>)}</tr><tr>
      <th className="border p-1"><input aria-label="Graded Id" className={field} value={filters.gradeId} onChange={event => setFilter('gradeId', event.target.value)} /></th>
      <th className="border p-1"><input aria-label="Inbound No" className={field} value={filters.inboundCode} onChange={event => setFilter('inboundCode', event.target.value)} /></th>
      <th className="border p-1"><input aria-label="Creation Date" className={field} value={filters.crtDate} onChange={event => setFilter('crtDate', event.target.value)} /></th>
      <th className="border p-1"><select aria-label="Status" className={field} value={filters.status} onChange={event => setFilter('status', event.target.value)}>{(meta.statuses || []).map(([value, label]: [string, string]) => <option key={value} value={value}>{label}</option>)}</select></th>
      <th className="border p-1"><select aria-label="Location" className={field} value={filters.locCode} onChange={event => setFilter('locCode', event.target.value)}>{(meta.locations || []).map(([value, label]: [string, string]) => <option key={value} value={value}>{label}</option>)}</select></th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
      <td className="border p-2"><button className="font-bold text-sky-700" onClick={() => navigate(`/app/r/sku-grading?gradeId=${encodeURIComponent(row.gradeId)}`)}>{row.gradeId}</button></td>
      <td className="border p-2">{row.inboundCode}</td><td className="border p-2">{row.crtDate}</td>
      <td className="border p-2"><span className={`px-2 py-1 text-white ${row.status === '4' ? 'bg-green-600' : 'bg-amber-500'}`}>{row.statusText}</span></td>
      <td className="border p-2">{row.locCode}</td>
    </tr>)}</tbody></table>
    {!rows.length && <div className="flex h-52 flex-col items-center justify-center gap-3 p-8 text-sm text-slate-500">
      <span>No SKU grades to view.</span><button className="font-semibold text-sky-700 underline" onClick={() => navigate('/app/r/sku-grading?gradeId=new')}>Add grade</button>
    </div>}
    <div className="flex justify-end gap-2 border-t p-2 text-xs">
      <button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>‹</button>
      <span>Page {pager.records ? pager.page : ''} of {pager.total}</span>
      <button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>›</button>
      <select aria-label="Page size" value={pager.size} onChange={event => void search(1, Number(event.target.value))}>{[20, 50, 100, 200].map(size => <option key={size}>{size}</option>)}</select>
      <span>{pager.records ? `View ${(pager.page - 1) * pager.size + 1} - ${Math.min(pager.page * pager.size, pager.records)} of ${pager.records}` : 'No records to view'}</span>
    </div>
    {exportOpen && <Modal title="**Please Select Field For Export" close={() => setExportOpen(false)}>
      <p className="mb-2">Export Type <b>Normal Export</b></p>
      {(meta.exportFields || []).map((name: string) => <label className="block" key={name}><input type="checkbox" checked={fields.includes(name)} onChange={event => setFields(event.target.checked ? [...fields, name] : fields.filter(value => value !== name))} /> {name}</label>)}
      <div className="mt-3"><Btn onClick={submitExport}>Export</Btn></div>
    </Modal>}
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </div>;
}

function Editor({ id }: { id: string }) {
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [meta, setMeta] = useState<any>({});
  const [row, setRow] = useState<any>(null);
  const [inbound, setInbound] = useState('');
  const [location, setLocation] = useState('-1');
  const [from, setFrom] = useState<any>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [inboundOpen, setInboundOpen] = useState(false);
  const [skuOpen, setSkuOpen] = useState(false);
  const [lot, setLot] = useState<any>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [to, setTo] = useState<any>({ sku: '', skuDesc: '', bin: '', lpn: '', mrp: '', wac: '', qty: '', unitPrice: '', lottables: Array(7).fill('') });
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    void apiGet<any>('/api/sku-grading').then(setMeta).catch((error: Error) => setToast({ msg: error.message, type: 'err' }));
    if (!isNew) void apiGet<any>(`/api/sku-grading?gradeId=${encodeURIComponent(id)}`).then(result => {
      setRow(result.row);
      setInbound(result.row?.inboundCode || '');
      setLocation(result.row?.locCode || '-1');
    }).catch((error: Error) => setToast({ msg: error.message, type: 'err' }));
  }, [id, isNew]);

  async function add() {
    if (!from || !to.sku || !to.bin || !to.qty || !to.unitPrice) return setToast({ msg: 'Invalid Data', type: 'err' });
    if (Number(from.availableQty || 0) < Number(to.qty)) return setToast({ msg: 'Sku available quantity is less than converted quantity.', type: 'err' });
    if (String(from.bin || '').toUpperCase() !== String(to.bin).toUpperCase() && String(from.lpn || '') === String(to.lpn || '')) {
      return setToast({ msg: 'From LPN and To LPN can not be same for different bin code.', type: 'err' });
    }
    try {
      const result = await apiSend<any>('/api/sku-grading', 'POST', {
        action: 'create-line', gradeId: row?.gradeId || '', inboundNo: inbound, locCode: location,
        fromSku: from.skuCode, fromSkuDesc: from.skuDesc, fromBin: from.bin,
        fromLpn: from.lpn, fromLot: from.lot, availableQty: from.availableQty,
        mrp: from.mrp, wac: from.wac, toSku: to.sku, toBin: to.bin, toLpn: to.lpn,
        qty: to.qty, unitPrice: to.unitPrice, lottables: to.lottables,
      });
      setRow(result.row);
      setGradeOpen(false);
      setToast({ msg: result.message, type: 'ok' });
      if (isNew) navigate(`/app/r/sku-grading?gradeId=${encodeURIComponent(result.row.gradeId)}`);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Unable to save grade', type: 'err' });
    }
  }

  async function confirm() {
    if (!row?.details?.length) return setToast({ msg: 'Invalid Data', type: 'err' });
    try {
      const result = await apiSend<any>('/api/sku-grading', 'POST', { action: 'confirm', gradeId: row.gradeId });
      setRow(result.row);
      setToast({ msg: result.message, type: 'ok' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Unable to confirm grade', type: 'err' });
    }
  }

  return <div className="border bg-white">
    <div className="flex justify-end gap-2 border-b p-3">
      {row?.status !== '4' && <Btn disabled={meta.available === false} title={meta.message} onClick={() => void confirm()}>Confirm</Btn>}
      <Btn variant="ghost" onClick={() => navigate('/app/r/sku-grading?gradeId=new')}>Add New</Btn>
      {row?.status === '4' && <Btn variant="ghost" onClick={() => setToast({ msg: selected.length ? 'SKU label printing requires a configured print template.' : 'Please Select Atleast One Sku To Generate Label', type: 'err' })}>Print</Btn>}
    </div>
    <div className="p-4"><h2 className="font-semibold">WMS Miscellaneous Sku Grading</h2>
      {!meta.available && <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">{meta.message || 'SKU grading is paused until its stock movements are connected to Central Inventory.'}</p>}
      <div className="mt-4 grid grid-cols-4 gap-3">
        <label className="text-xs">Inbound No<div className="flex"><input aria-label="Inbound No" className="inp mt-1" value={inbound} onChange={event => setInbound(event.target.value)} /><button aria-label="Select Inbound" onClick={() => setInboundOpen(true)} className="border px-3">...</button></div></label>
        <label className="text-xs">Location<select aria-label="Grade Location" className="inp mt-1" value={location} disabled={Boolean(row)} onChange={event => setLocation(event.target.value)}>
          {(meta.locations || [['-1', '--- Select ---']]).map(([code, name]: [string, string]) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        <label className="text-xs">Graded Id<input aria-label="Graded Id" className="inp mt-1" disabled value={row?.gradeId || ''} /></label>
        <label className="text-xs">Status<input aria-label="Status" className="inp mt-1" disabled value={row?.statusText || ''} /></label>
      </div>
      {row?.status !== '4' && <fieldset className="mt-5 border p-3"><legend>Grade From</legend>
        <div className="grid grid-cols-4 gap-2"><label className="text-xs">SKU Code<div className="flex"><input aria-label="From SKU Code" className="inp" value={from?.skuCode || ''} readOnly /><button aria-label="Select SKU" disabled={!meta.available} onClick={() => { if (!inbound) return setToast({ msg: 'Please Select Inbound No', type: 'err' }); setSkuOpen(true); }} className="border px-3 disabled:opacity-50">...</button></div></label>
          {([['SKU Desc', from?.skuDesc], ['Bin Location', from?.bin], ['LPN', from?.lpn], ['Lot', from?.lot], ['MRP', from?.mrp], ['WAC', from?.wac], ['Available Qty', from?.availableQty]] as [string, any][]).map(([label, value]) => <label className="text-xs" key={label}>{label}<input aria-label={label} className="inp" readOnly value={value || ''} /></label>)}
        </div><div className="mt-3 flex gap-2"><Btn disabled={!meta.available} title={meta.message} onClick={() => setGradeOpen(true)}>Add Grade To</Btn><Btn variant="ghost" onClick={() => setFrom(null)}>Reset</Btn></div>
      </fieldset>}
      <table className="mt-5 w-full text-xs"><thead><tr>{['', '', 'SKU Code', 'Bin Location', 'LPN', 'Lot', 'MRP', 'WAC', 'Rcvd Qty', 'Unit Price'].map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr></thead><tbody>{(row?.details || []).map((line: any) => <tr key={line.id} className="border-t">
        <td><input aria-label={`Select ${line.displaySku}`} type="checkbox" checked={selected.includes(line.id)} onChange={event => setSelected(event.target.checked ? [...selected, line.id] : selected.filter(value => value !== line.id))} /></td>
        <td>+</td><td>{line.displaySku}</td><td>{line.fromBinLoc}</td><td>{line.fromIdCode}</td>
        <td><button className="text-sky-700" onClick={() => setLot(line)}>{line.fromLotNo}</button></td>
        <td>{line.mrp}</td><td>{line.wac}</td><td>{line.rcvdQty}</td><td>{line.unitPrice}</td>
      </tr>)}</tbody></table>
    </div>
    {inboundOpen && <Picker title="Inbound Pick List" close={() => setInboundOpen(false)} heads={['Inbound No', 'Inbound Type']} rows={(meta.inbound || []).map((value: any) => [value.inboundCode, value.inboundType, value.locationCode])} choose={value => {
      setInbound(value[0]);
      if ((meta.locations || []).some(([code]: Pair) => code === value[2])) setLocation(value[2]);
      setInboundOpen(false);
    }} />}
    {skuOpen && <Picker title="SKUs" close={() => setSkuOpen(false)} heads={['SKU Code', 'SKU Desc', 'Size', 'Color']} rows={(meta.inventory || []).map((value: any) => [value.skuCode, value.skuDesc, value.size, value.color, value])} choose={value => { setFrom(value[4]); setSkuOpen(false); }} />}
    {gradeOpen && <Modal title="Grade To" close={() => setGradeOpen(false)}><div className="grid grid-cols-2 gap-2">
      {([['SKU Code', 'sku'], ['SKU Desc', 'skuDesc'], ['Bin Location', 'bin'], ['LPN', 'lpn'], ['MRP', 'mrp'], ['WAC', 'wac'], ['Qty to Convert', 'qty'], ['Unit Price', 'unitPrice']] as [string, string][]).map(([label, key]) => <label className="text-xs" key={key}>{label}<input aria-label={`To ${label}`} className="inp" value={to[key]} onChange={event => setTo({ ...to, [key]: event.target.value })} /></label>)}
      </div><div className="mt-3"><Btn onClick={() => void add()}>Add</Btn></div></Modal>}
    {lot && <Modal title="Lot Details" close={() => setLot(null)}>{Array.from({ length: 7 }, (_, index) => <p key={index}>Lottable {index + 1} <b>{lot.toLottables?.[index] || ''}</b></p>)}</Modal>}
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </div>;
}

type Pair = [string, string];

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div role="dialog" aria-label={title} className="max-h-[85vh] w-[620px] overflow-auto bg-white">
    <h3 className="border-b p-3 font-semibold">{title}</h3><div className="p-4">{children}</div><div className="border-t p-3 text-right"><Btn variant="ghost" onClick={close}>Close</Btn></div>
  </div></div>;
}

function Picker({ title, close, heads, rows, choose }: { title: string; close: () => void; heads: string[]; rows: any[][]; choose: (row: any[]) => void }) {
  return <Modal title={title} close={close}><table className="w-full text-xs"><thead><tr>{heads.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} onClick={() => choose(row)} className="cursor-pointer border-t">{row.slice(0, heads.length).map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table>
    <div className="mt-3 flex gap-2"><Btn onClick={() => rows[0] && choose(rows[0])}>OK</Btn></div>
  </Modal>;
}
