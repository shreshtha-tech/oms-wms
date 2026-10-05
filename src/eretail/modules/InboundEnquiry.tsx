import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search as SearchIcon } from 'lucide-react';
import Shell from '../Shell';
import EnquiryScreen, { type EField } from '../EnquiryScreen';
import { Toast } from '../parts';
import Modal from '../../components/Modal';
import OrderGrid, { type GCol } from '../OrderGrid';
import { apiGet, apiSend } from '../../lib/api';

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const iso = (v: string) => { const [d, m, y] = v.split('/'); return y && m && d ? `${y}-${m}-${d}` : v; };
const today = new Date(), sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
const creationRange = `${dmy(sixtyDaysAgo)} - ${dmy(today)}`;
const initialFilters = { createdDate: creationRange, inboundLoc: '' };
const blankAdvanced: any = { fromInboundNo: '', fromGRNNo: '', vendorCode: '', createdDate: '', GRNDate: '', locationCode: '', PONo: '', status: '', fromInvoiceNo: '', inboundType: '', isBarCode: true, skuCode: '', orderNo: '', lotCode: '', lotNoArr: '', mhierachyCode: '', hierarchyCode: '', usnNo: '', inbLpn: '' };

export default function InboundEnquiry() {
  const nav = useNavigate();
  const [meta, setMeta] = useState<any>({}), [rows, setRows] = useState<any[]>([]), [selected, setSelected] = useState<number[]>([]);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 }), [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState<any>({ ...blankAdvanced }), [advOpen, setAdvOpen] = useState(false);
  const [picker, setPicker] = useState<'vendor' | 'lot' | 'hierarchy' | null>(null), [lotText, setLotText] = useState('');
  const [vendorFilterSetter, setVendorFilterSetter] = useState<null | ((value: string) => void)>(null);
  const [toast, setToast] = useState<any>(null);
  useEffect(() => { apiGet('/api/inbound-enquiry').then(setMeta).catch((e: any) => setToast({ msg: e.message, type: 'err' })); }, []);

  const setAdv = (key: string, value: any) => setAdvanced((x: any) => ({ ...x, [key]: value }));
  async function search(f: any = initialFilters, page = 1, size = pager.pageSize) {
    const filters = { ...advanced, ...f }, created = String(advanced.createdDate || f.createdDate || creationRange).split(' - '), grn = String(advanced.GRNDate || '').split(' - ');
    setLoading(true);
    try {
      const r: any = await apiSend('/api/inbound-enquiry', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, doFetchCount: false, rows: size, page, sidx: 'inbound0_.crtDate', sord: 'desc',
        ...filters,
        fromCreatedDate: iso(created[0] || ''), toCreatedDate: iso(created[1] || ''),
        fromGRNDate: iso(grn[0] || ''), toGRNDate: iso(grn[1] || ''),
        fromInboundNo: f.inboundNo || advanced.fromInboundNo || '', fromExtInboundNo: f.extInboundCode || '', transferNo: f.transferNo || '',
        asnNumber: f.asnNumber || '', PONo: f.poNo || advanced.PONo || '', fromGRNNo: f.GRNNo || advanced.fromGRNNo || '',
        fromInvoiceNo: f.invoiceNo || advanced.fromInvoiceNo || '', vendorCode: f.vendorCode || advanced.vendorCode || '',
        inboundType: f.displayInboundType || advanced.inboundType || '', status: f.status || advanced.status || '', qcStatus: f.qcStatus || '',
        ExtCustReturnNo: f.extCustReturnNo || '', ExtInvoiceNo: f.extInvoiceNo || '', inbLpn: advanced.inbLpn || '',
      });
      setRows(r.inboundList || []); setPager({ page: r.page, total: r.total, records: r.records, pageSize: r.rows }); setSelected([]);
    } catch (e: any) { setToast({ msg: e.message, type: 'err' }); setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: size }); }
    finally { setLoading(false); }
  }
  function reset() { setRows([]); setSelected([]); setAdvanced({ ...blankAdvanced }); setPager({ page: 0, total: 0, records: 0, pageSize: 20 }); setToast(null); }
  async function act(action: string) { try { const r: any = await apiSend('/api/inbound-enquiry', 'POST', { action, id: selected[0] }); setToast({ msg: r.jsonMessage, type: 'ok' }); nav(r.target); } catch (e: any) { setToast({ msg: e.message, type: 'err' }); } }

  const cols: any[] = [
    { key: 'inboundNo', label: 'Inbound No', render: (r: any) => <button className="font-semibold text-sky-700" onClick={() => nav(`/app/r/inbound-realtime?inboundNo=${encodeURIComponent(r.inboundNo)}`)}>{r.inboundNo}</button> },
    { key: 'extInboundCode', label: 'Ext Inbound No' }, { key: 'transferNo', label: 'STO No' }, { key: 'asnNumber', label: 'ASN No' },
    { key: 'poNo', label: 'PO No' }, { key: 'GRNNo', label: 'GRN No' }, { key: 'createdDate', label: 'Creation Date' },
    { key: 'displayInboundType', label: 'Inbound Type', filter: 'select', options: (meta.inboundTypes || []).map((x: any) => x[1]) },
    { key: 'invoiceNo', label: 'Invoice No' }, { key: 'vendorCode', label: 'vendor', filterAction: (_value: string, setValue: (value: string) => void) => { setVendorFilterSetter(() => setValue); setPicker('vendor'); }, render: (r: any) => <span><span className="block text-sky-700">{r.vendorCode}</span><i className="text-xs">{r.vendorName}</i></span> },
    { key: 'status', label: 'Status', filter: 'select', options: (meta.statuses || []).map((x: any) => x[1]) },
    { key: 'qcStatus', label: 'QC Status', filter: 'select', options: ['in QC', 'QC Done'] },
    { key: 'inboundLoc', label: 'Inbound Location', filter: 'select', options: (meta.locations || []).map((x: string[]) => x[1]) },
    { key: 'extCustReturnNo', label: 'Ext Return No' }, { key: 'extInvoiceNo', label: 'Ext Invoice No' },
  ];
  const advancedFields: EField[] = advOpen ? [
    { key: 'fromInboundNo', label: 'Inbound No', value: advanced.fromInboundNo, onChange: (v) => setAdv('fromInboundNo', v) },
    { key: 'fromGRNNo', label: 'GRN No', value: advanced.fromGRNNo, onChange: (v) => setAdv('fromGRNNo', v) },
    { key: 'vendorCode', label: 'Vendor Code', value: advanced.vendorCode, onChange: (v) => setAdv('vendorCode', v), filterAction: () => setPicker('vendor') },
    { key: 'createdDate', label: 'Creation Date', value: advanced.createdDate, onChange: (v) => setAdv('createdDate', v) },
    { key: 'GRNDate', label: 'GRN Date', value: advanced.GRNDate, onChange: (v) => setAdv('GRNDate', v) },
    { key: 'locationCode', label: 'Location Code', type: 'select', options: ['--- Select ---', ...(meta.locations || []).map((x: string[]) => x[1])], value: advanced.locationCode, onChange: (v) => setAdv('locationCode', v === '--- Select ---' ? '' : v) },
    { key: 'PONo', label: 'PO No', value: advanced.PONo, onChange: (v) => setAdv('PONo', v) },
    { key: 'status', label: 'Status', type: 'select', options: (meta.statuses || []).map((x: any) => x[1]), value: advanced.status, onChange: (v) => setAdv('status', v) },
    { key: 'fromInvoiceNo', label: 'Invoice No', value: advanced.fromInvoiceNo, onChange: (v) => setAdv('fromInvoiceNo', v) },
    { key: 'inboundType', label: 'Inbound Type', type: 'select', options: ['--- Select ---', ...(meta.inboundTypes || []).map((x: any) => x[1])], value: advanced.inboundType, onChange: (v) => setAdv('inboundType', v) },
    { key: 'isBarCode', label: 'BarCode', type: 'checkbox', checked: advanced.isBarCode, onChange: (v) => setAdv('isBarCode', v) },
    { key: 'skuCode', label: 'SKUCode', value: advanced.skuCode, onChange: (v) => setAdv('skuCode', v) },
    { key: 'orderNo', label: 'Order No', disabled: !['Delivered Return', 'Non Delivered Return', 'With STO', '3', '4', '5'].includes(advanced.inboundType), value: advanced.orderNo, onChange: (v) => setAdv('orderNo', v) },
    { key: 'lotCode', label: 'Lot No', disabled: true, value: advanced.lotCode, filterAction: () => setPicker('lot') },
    { key: 'hierarchyCode', label: 'Hierarchy Code', disabled: true, value: advanced.hierarchyCode, filterAction: () => setPicker('hierarchy') },
    { key: 'usnNo', label: 'USN', value: advanced.usnNo, onChange: (v) => setAdv('usnNo', v) },
    { key: 'inbLpn', label: 'LPN', value: advanced.inbLpn, onChange: (v) => setAdv('inbLpn', v) },
  ] : [];
  const vendorCols: GCol[] = [{ key: 'code', label: 'Vendor Code' }, { key: 'name', label: 'Vendor Name' }];
  const actions: any[] = [{ label: 'Advance Search', icon: SearchIcon, onClick: () => setAdvOpen(!advOpen) }, { label: 'Add New', icon: Plus, onClick: () => nav('/app/r/inbound-realtime') }, { label: 'PutAway', onClick: () => void act('putaway') }];

  return <Shell active="wms" breadcrumb="WMS > Inbound > Inbound Enquiry" openScreens={[{ label: 'Inbound Enquiry', to: '#' }]}>
    <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Inbound QC changes are unavailable until rejected and held quantities can be recorded in Central Inventory.</div>
    <EnquiryScreen breadcrumb={[{ label: 'WMS' }, { label: 'Inbound' }, { label: 'Inbound Enquiry' }]} cols={cols} fields={advancedFields} rows={rows} loading={loading} remote={pager} initialFilters={initialFilters} pageSizes={[20, 50, 100, 200]} selectedIds={selected} onSelectionChange={(ids) => setSelected(ids.slice(-1))} onSearch={search} onReset={reset} actions={actions} />
    <Modal title="Vendor" open={picker === 'vendor'} onClose={() => { setPicker(null); setVendorFilterSetter(null); }}><OrderGrid cols={vendorCols} rows={meta.vendors || []} empty="No vendors to view" onRowClick={(r: any) => { if (vendorFilterSetter) vendorFilterSetter(r.code); else setAdv('vendorCode', r.code); setVendorFilterSetter(null); setPicker(null); }} /></Modal>
    <Modal title="Multiple Lot No" open={picker === 'lot'} onClose={() => setPicker(null)}><textarea aria-label="Lot Numbers" className="h-40 w-full border p-2" value={lotText} onChange={(e) => setLotText(e.target.value)} /><div className="mt-3 flex justify-end"><button className="rounded bg-amber-500 px-3 py-2 text-white" onClick={() => { const values = lotText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (!values.length) return setToast({ msg: 'Please Enter LotNo', type: 'err' }); if (values.length > 100) return setToast({ msg: 'Max 100 Records Can Be Entered', type: 'err' }); setAdv('lotNoArr', values.join('\n')); setAdv('lotCode', values.join(', ')); setPicker(null); }}>Search</button></div></Modal>
    <Modal title="Hierarchy Code" open={picker === 'hierarchy'} onClose={() => setPicker(null)}>{(meta.hierarchies || []).map((x: any) => <button key={x.code} className="block w-full border-b p-3 text-left" onClick={() => { setAdv('hierarchyCode', x.name); setAdv('mhierachyCode', x.code); setPicker(null); }}>{x.code} — {x.name}</button>)}</Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
