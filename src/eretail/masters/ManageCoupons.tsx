import { useState } from 'react';
import { Download, SlidersHorizontal } from 'lucide-react';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import EnquiryScreen, { ECol } from '../EnquiryScreen';
import { apiForm } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';

type CouponRow = {
  id: number;
  coupon_key?: string;
  description?: string;
  coupon_type?: string;
  status?: string;
  coupon_code?: string;
  start_date?: string;
  end_date?: string;
  active_date?: string;
  created_by?: string;
  discount_value?: number;
  min_order?: number;
  usage_limit?: number;
};

const TYPES = ['Line', 'Bill'];
const fmt = (iso?: string) => {
  if (!iso) return '';
  const date = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : iso;
};

export default function ManageCoupons() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [lastFilters, setLastFilters] = useState<Record<string, string>>({});
  const [view, setView] = useState<CouponRow | null>(null);
  const [error, setError] = useState('');

  const load = async (filters = lastFilters, nextPage = 1, nextSize = pageSize) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiForm<any>('/api/fetchCouponEnquiryData', {
        _search: true, rows: nextSize, page: nextPage, sidx: 'couponKey', sord: 'desc', loccode: '',
        couponKey: filters.coupon_key || '', desc: filters.description || '', couponCode: filters.coupon_code || '',
        couponType: ({ Line: '1', Bill: '2' } as Record<string, string>)[filters.coupon_type] || '-1',
        couponStatus: ({ Cancelled: '7', Confirmed: '4', 'Pending Confirmation': '1' } as Record<string, string>)[filters.status] || '-1',
        fromOrderDate: filters.fromOrderDate || '', toOrderDate: filters.toOrderDate || '',
        fromActiveDate: filters.fromActiveDate || '', toActiveDate: filters.toActiveDate || '',
        clientId: '-1', REQ_SEARCH_FLAG: true,
      });
      setRows(result.gridModel || []);
      setPage(result.page || nextPage);
      setPageSize(nextSize);
      setRecords(result.records || 0);
      setTotal(result.total || 0);
      setLastFilters(filters);
    } catch (cause) {
      setRows([]);
      setRecords(0);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : 'Coupon enquiry failed.');
    } finally {
      setLoading(false);
    }
  };

  const download = () => requestDownload({
    title: 'Coupon Enquiry — displayed page', module: 'coupons', baseName: 'coupons-current-page',
    data: {
      columns: ['Coupon Key', 'Description', 'Coupon Type', 'Status', 'Coupon Code', 'Start Date', 'End Date', 'Active Date', 'Created By'],
      rows: rows.map(r => [r.coupon_key || '', r.description || '', r.coupon_type || '', r.status || '', r.coupon_code || '', fmt(r.start_date), fmt(r.end_date), fmt(r.active_date), r.created_by || '']),
    },
  });

  const cols: ECol[] = [
    { key: 'coupon_key', label: 'Coupon Key', filter: 'text', align: 'left', render: r => <button onClick={() => setView(r)} className="font-medium text-[#2f7fb6] hover:underline">{r.coupon_key}</button> },
    { key: 'description', label: 'Description', filter: 'text', align: 'left' },
    { key: 'coupon_type', label: 'Coupon Type', filter: 'select', options: TYPES },
    { key: 'status', label: 'Status', filter: 'select', options: ['Cancelled', 'Confirmed', 'Pending Confirmation'] },
    { key: 'coupon_code', label: 'Coupon Code', filter: 'text' },
    { key: 'start_date', label: 'Start Date', filter: 'none', render: r => fmt(r.start_date) },
    { key: 'end_date', label: 'End Date', filter: 'none', render: r => fmt(r.end_date) },
    { key: 'active_date', label: 'Active Date', filter: 'text', render: r => fmt(r.active_date) },
    { key: 'created_by', label: 'Created By', filter: 'none' },
  ];

  return <Shell active="master" breadcrumb="MASTER > Coupon Management > Coupon Enquiry" openScreens={[{ label: 'Manage Coupons', to: '#' }]}>
    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 p-3 text-sm">
      <span>Coupon records are read-only legacy metadata. A Confirmed status does not establish checkout eligibility or redemption. Download exports the displayed page only.</span>
      <button disabled title="Coupon creation is unavailable" className="rounded border bg-white px-3 py-2 opacity-50">Add New unavailable</button>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <EnquiryScreen
      breadcrumb={[{ label: 'Master' }, { label: 'Coupon Management' }, { label: 'Coupon Enquiry' }]}
      cols={cols} rows={rows} loading={loading}
      actions={[
        { label: 'Advance Search', icon: SlidersHorizontal, onClick: () => setAdvanced(value => !value) },
        { label: 'Download', icon: Download, onClick: download },
      ]}
      actionsBeforeResetCount={1}
      fields={advanced ? [
        { key: 'fromOrderDate', label: 'Start Date' }, { key: 'toOrderDate', label: 'End Date' },
        { key: 'fromActiveDate', label: 'Active Date From' }, { key: 'toActiveDate', label: 'Active Date To' },
      ] : []}
      onSearch={(filters, nextPage, nextSize) => void load(filters, nextPage, nextSize)}
      onReset={() => { setRows([]); setRecords(0); setTotal(0); setLastFilters({}); setError(''); }}
      remote={{ page, pageSize, records, total }}
    />
    <Modal title={`Coupon — ${view?.coupon_key || ''}`} open={!!view} onClose={() => setView(null)} wide>
      {view && <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {([['Coupon Key', view.coupon_key], ['Coupon Code', view.coupon_code], ['Type', view.coupon_type], ['Discount', view.discount_value], ['Min Order', view.min_order], ['Usage Limit', view.usage_limit], ['Start Date', fmt(view.start_date)], ['End Date', fmt(view.end_date)], ['Active Date', fmt(view.active_date)], ['Status', view.status], ['Created By', view.created_by], ['Description', view.description || '—']] as const).map(([label, value]) =>
          <div key={label}><p className="text-xs text-slate-400">{label}</p><p className="font-medium text-slate-700">{value}</p></div>)}
      </div>}
    </Modal>
  </Shell>;
}
