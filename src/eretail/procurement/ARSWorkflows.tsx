/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Download,
  FileUp,
  History,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import Shell from "../Shell";
import Modal from "../../components/Modal";
import { Btn, Toast } from "../parts";
import { apiGet, apiSend } from "../../lib/api";
import { useDownload } from "../../context/DownloadContext";
import { useActiveLocations } from "../../hooks/useActiveLocations";

type Notice = { msg: string; type: "ok" | "err" } | null;
const LOCATION_TYPES = [{ value: "6", label: "Franchise" }, { value: "3", label: "Store" }, { value: "2", label: "WH" }];
const FULFILMENT = ["Direct Store Purchase", "Distribution Center"];
const ARS_STATUS = ["Pending", "Active", "InActive", "Discontinued"];
const RULE_METHODS = ["Min-Max", "Sales History"];
const VENDOR_TYPES = ["Min Cost", "Min Lead Tim", "Primary"];
const OUTPUT_TYPES = ["Confirmed", "Pending", "Report"];
const SKU_SET_TYPES = ["Brand", "Group", "Hierarchy", "SKU", "Vendor"];
const FREQUENCIES = [
  { v: "6", l: "Never" },
  { v: "2", l: "Bimonthly" },
  { v: "1", l: "Monthly" },
  { v: "4", l: "Biweekly" },
  { v: "3", l: "Weekly" },
  { v: "5", l: "Daily" },
];
const cls =
  "w-full rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-cyan-500";
const statusCls = (s: string) =>
  s === "Active" || s === "Completed" || s === "Confirmed"
    ? "bg-emerald-500"
    : s === "Pending"
      ? "bg-amber-500"
      : s === "Failed"
        ? "bg-rose-500"
        : "bg-slate-500";
const Status = ({ value }: { value: string }) => (
  <span
    className={`inline-block min-w-20 rounded-sm px-2 py-1 text-center text-[11px] font-semibold text-white ${statusCls(value)}`}
  >
    {value}
  </span>
);
const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="border-r border-slate-300 bg-[#e9edf1] px-2 py-2 text-left text-[11px] font-semibold text-slate-600">
    {children}
  </th>
);
const Td = ({ children }: { children?: React.ReactNode }) => (
  <td className="border-r border-t border-slate-200 px-2 py-2 align-top text-xs text-slate-600">
    {children}
  </td>
);
const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <label className="grid grid-cols-[135px_minmax(0,1fr)] items-center gap-2 text-xs text-slate-500">
    <span className="text-right">
      {label}
      {required && <b className="text-rose-500"> *</b>}
    </span>
    {children}
  </label>
);
const Bar = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 flex flex-wrap justify-end gap-2">{children}</div>
);

function HierarchyPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: string) => void;
}) {
  const nodes = [
    "Apparel",
    "Beauty",
    "Books",
    "Electronics",
    "Footwear",
    "Healthcare",
    "Home & Living",
    "media",
    "Sports",
    "Watches",
  ];
  const [value, setValue] = useState("");
  return (
    <Modal
      title="Merchandising Hierarchy Pick List"
      open={open}
      onClose={onClose}
    >
      <div className="max-h-72 overflow-auto border p-3">
        {nodes.map((n) => (
          <label key={n} className="block py-1 text-sm">
            <input
              type="radio"
              name="hierarchy"
              checked={value === n}
              onChange={() => setValue(n)}
            />{" "}
            ⊞ {n}
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Btn
          onClick={() => {
            if (value) onPick(value);
            onClose();
          }}
        >
          OK
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Modal>
  );
}

export function ARSSkuLocation() {
  const nav = useNavigate();
  const { requestDownload } = useDownload();
  const { locations: activeLocations } = useActiveLocations();
  const [rows, setRows] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [show, setShow] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [hierarchy, setHierarchy] = useState(false);
  const [hierarchyTarget, setHierarchyTarget] = useState<'search' | 'bulk'>('search');
  const [vendorPicker, setVendorPicker] = useState(false);
  const [vendorPickerTarget, setVendorPickerTarget] = useState<'editor' | 'bulk-filter' | 'bulk-update'>('editor');
  const [vendorFilter, setVendorFilter] = useState({ code: "", name: "" });
  const [notice, setNotice] = useState<Notice>(null);
  const [edit, setEdit] = useState<any>(null);
  const empty = {
    sku_code: "",
    location: "",
    sku_location_tag: "-1",
    fulfilment_method: "",
    fulfilment_wh: "",
    wh_lead_time: "",
    primary_vendor: "",
    stock_cover_days: "",
    minimum_transfer_qty: "1.00",
    transfer_unit_factor: "1.00",
    ars_flag: "",
    maximum_order_qty: "0.00",
    is_cico: false,
    case_size: "",
  };
  const [form, setForm] = useState(empty);
  const [filters, setFilters] = useState({
    location: [] as string[],
    sku_code: "",
    category: "",
    brand: "",
    primary_vendor: "",
    fulfilment_method: "",
    fulfilment_wh: "",
    wh_lead_time: "",
    stock_cover_days: "",
    ars_flag: "",
    sku_name: "",
  });
  const [bulkForm, setBulkForm] = useState({
    location_type: "-1",
    location: "-1",
    category: "",
    sku_group: "-1",
    primary_vendor: "",
    brand: "-1",
    sku_code: "",
    minimum_transfer_qty: "1.00",
    transfer_unit_factor: "1.00",
    ars_flag: "-1",
    stock_cover_days: "",
    primary_vendor_update: "",
    vendor_lead_time: "",
    fulfilment_method: "-1",
    fulfilment_wh: "-1",
    wh_lead_time: "",
    maximum_order_qty: "0.00",
    sku_location_tag: "-1",
    case_size: "",
    is_cico: false,
    add_new: false,
    checks: {} as Record<string, boolean>,
  });
  const locationOptions = activeLocations.map((row) => ({
    value: row.location_name,
    label: `${row.location_name} (${row.location_code})`,
  }));
  const loadMasters = () => {
    Promise.all([apiGet<any[]>("/api/skus"), apiGet<any[]>("/api/vendors")])
      .then(([skuRows, vendorRows]) => {
        setSkus(skuRows);
        setVendors(vendorRows);
      })
      .catch((e) => setNotice({ msg: e.message, type: "err" }))
  };
  useEffect(() => {
    void loadMasters();
  }, []);
  const search = async (nextPage = 1, nextSize = pageSize) => {
    setLoading(true); setNotice(null);
    try {
      const result = await apiSend<any>("/api/fetchArsAttributes", "POST", { rows: nextSize, page: nextPage, sidx: "", sord: "asc", clientId: "0", location: filters.location.join("\u0017"), sku: filters.sku_code, skuName: filters.sku_name, category: filters.category, brand: filters.brand, primaryVendor: filters.primary_vendor, fullFillmentMethod: filters.fulfilment_method, fullFillmentWh: filters.fulfilment_wh, fullfillmentWhLeadTime: filters.wh_lead_time, stockCoverDays: filters.stock_cover_days, arsFlag: filters.ars_flag, REQ_SEARCH_FLAG: true });
      setRows(result.gridModel || result.rows || []); setPage(result.page); setTotal(result.total); setRecords(result.records); setPageSize(nextSize); setSearched(true);
    } catch (error: any) { setRows([]); setNotice({ msg: error.message, type: "err" }); }
    finally { setLoading(false); }
  };
  const reset = () => {
    setFilters({
      location: [],
      sku_code: "",
      category: "",
      brand: "",
      primary_vendor: "",
      fulfilment_method: "",
      fulfilment_wh: "",
      wh_lead_time: "",
      stock_cover_days: "",
      ars_flag: "",
      sku_name: "",
    });
    setRows([]); setPage(1); setPageSize(20); setRecords(0); setTotal(0); setSearched(false); setAdvanced(false); setNotice(null);
  };
  const openNew = () => {
    setEdit(null);
    setForm(empty);
    setShow(true);
  };
  const save = async () => {
    if (!form.sku_code) return setNotice({ msg: "SkuCode is mandatory", type: "err" });
    if (edit && !form.transfer_unit_factor) return setNotice({ msg: "Transfer Unit Factor is mandatory", type: "err" });
    if (edit && !form.minimum_transfer_qty) return setNotice({ msg: "Minimum Transfer Qty is mandatory", type: "err" });
    if (form.transfer_unit_factor && Number(form.transfer_unit_factor) < 1) return setNotice({ msg: "Transfer Unit Factor cannot be Zero.", type: "err" });
    if (form.minimum_transfer_qty && Number(form.minimum_transfer_qty) < 1) return setNotice({ msg: "Minimum Transfer Qty cannot be Zero.", type: "err" });
    if (!form.location) return setNotice({ msg: "Location is mandatory", type: "err" });
    if (!form.ars_flag) return setNotice({ msg: "ArsFlag is mandatory", type: "err" });
    if (form.is_cico && !form.case_size) return setNotice({ msg: "Case Size is Mandatory.", type: "err" });
    if (form.case_size && (!Number.isInteger(Number(form.case_size)) || Number(form.case_size) <= 0)) return setNotice({ msg: "Case Size must be positive integer.", type: "err" });
    try {
      await apiSend("/api/addAndUpdateArsAttributes", "POST", {
        id: edit?.id,
        client: "0",
        skuCode: form.sku_code,
        location: form.location,
        fullFillMentMethod: form.fulfilment_method,
        fullFillMentWH: form.fulfilment_wh,
        whLeadTime: form.wh_lead_time,
        primaryVendor: form.primary_vendor,
        stockCoverDays: form.stock_cover_days,
        minimumTransferQty: form.minimum_transfer_qty,
        transferUnitFactor: form.transfer_unit_factor,
        arsFlag: form.ars_flag,
        maximumOrderQty: form.maximum_order_qty || "0",
        skuLocationTag: form.sku_location_tag,
        isCICO: form.is_cico ? "1" : "0",
        caseSize: form.case_size,
      });
      const successMessage = edit ? "Data Updated successfully." : "ARS Data Adding/Updating in Grid";
      setShow(false);
      if (searched) await search(1); else setRows([]);
      setNotice({ msg: successMessage, type: "ok" });
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
    }
  };
  const bulkUpdate = async () => {
    if (!bulkForm.location_type || bulkForm.location_type === "-1") return setNotice({ msg: "Location Type is mandatory", type: "err" });
    if (bulkForm.transfer_unit_factor && Number(bulkForm.transfer_unit_factor) < 1) return setNotice({ msg: "Transfer Unit Factor cannot be Zero.", type: "err" });
    if (bulkForm.minimum_transfer_qty && Number(bulkForm.minimum_transfer_qty) < 1) return setNotice({ msg: "Minimum Transfer Qty cannot be Zero.", type: "err" });
    if (!Object.values(bulkForm.checks).some(Boolean)) return setNotice({ msg: "Select at least one attribute to update", type: "err" });
    if (bulkForm.add_new && (!bulkForm.ars_flag || bulkForm.ars_flag === "-1")) return setNotice({ msg: "ArsFlag is mandatory", type: "err" });
    try {
      const result: any = await apiSend("/api/bulkUpdateArsAttributes", "POST", {
        client: "0", locationType_bulk: bulkForm.location_type, location_bulk: bulkForm.location,
        categoryCode: bulkForm.category, skuGroup_bulk: bulkForm.sku_group, vendorCode: bulkForm.primary_vendor,
        brand_bulk: bulkForm.brand, sku_bulk: bulkForm.sku_code, minimumTransferQty_bulk: bulkForm.minimum_transfer_qty,
        transferUnitFactor_bulk: bulkForm.transfer_unit_factor, arsFlag_bulk: bulkForm.ars_flag,
        stockCoverDays_bulk: bulkForm.stock_cover_days, primaryVendor_bulk: bulkForm.primary_vendor_update,
        vendorLeadTime_bulk: bulkForm.vendor_lead_time, fullfillmentMethod_bulk: bulkForm.fulfilment_method,
        fullfillmentWH_bulk: bulkForm.fulfilment_wh, whLeadTime_bulk: bulkForm.wh_lead_time,
        addNewFlag: bulkForm.add_new, maximumOrderQty_bulk: bulkForm.maximum_order_qty,
        skuLocationTag_bulk: bulkForm.sku_location_tag, caseSize_bulk: bulkForm.case_size,
        isCICO_ValueCB: bulkForm.is_cico,
        arsCheckBox: !!bulkForm.checks.ars_flag, stockCoverDaysCheckBox: !!bulkForm.checks.stock_cover_days,
        primaryVendorCheckBox: !!bulkForm.checks.primary_vendor_update, fullfillmentMethodCheckBox: !!bulkForm.checks.fulfilment_method,
        fullfillmentWHCheckBox: !!bulkForm.checks.fulfilment_wh, fullfillmentWhLeadTimeCheckBox: !!bulkForm.checks.wh_lead_time,
        minimumTransferQtyCheckBox: !!bulkForm.checks.minimum_transfer_qty, transferUnitFactorCheckBox: !!bulkForm.checks.transfer_unit_factor,
        maximumOrderQtyCheckBox: !!bulkForm.checks.maximum_order_qty, skuLocationTagCheckBox: !!bulkForm.checks.sku_location_tag,
        caseSizeCheckBox: !!bulkForm.checks.case_size, isCICOCheckBox: !!bulkForm.checks.is_cico,
      });
      if (searched) await search(1); else setRows([]);
      setNotice({ msg: `ARS Location Link updated successfully.${result?.skuLocLinkDTO?.updatedRowCount != null ? ` Updated Count: ${result.skuLocLinkDTO.updatedRowCount}` : ""}`, type: "ok" });
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
    }
  };
  const bulkCheck = (key: string) => ({
    checked: !!bulkForm.checks[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBulkForm({ ...bulkForm, checks: { ...bulkForm.checks, [key]: event.target.checked } }),
  });
  const openBulk = () => {
    setBulkForm({ location_type: '-1', location: '-1', category: '', sku_group: '-1', primary_vendor: '', brand: '-1', sku_code: '', minimum_transfer_qty: '1.00', transfer_unit_factor: '1.00', ars_flag: '-1', stock_cover_days: '', primary_vendor_update: '', vendor_lead_time: '', fulfilment_method: '-1', fulfilment_wh: '-1', wh_lead_time: '', maximum_order_qty: '0.00', sku_location_tag: '-1', case_size: '', is_cico: false, add_new: false, checks: {} });
    setBulk(true);
  };
  const exportRows = () => {
    if (!rows.length) return setNotice({ msg: "No displayed rows to export", type: "err" });
    const fields = ['location', 'sku_code', 'category', 'brand', 'primary_vendor', 'fulfilment_method', 'fulfilment_wh', 'wh_lead_time', 'stock_cover_days', 'minimum_transfer_qty', 'transfer_unit_factor', 'ars_flag'];
    requestDownload({ title: 'ARS SKU-Location Link', module: 'ARS SKU-Location Link', baseName: `ars-sku-location-page-${page}`, data: {
      columns: ['Location', 'SKU', 'Category', 'Brand', 'Primary Vendor', 'Fulfillment Method', 'Fulfillment WH', 'WH Lead Time', 'Stock Cover Days', 'Minimum Transfer Qty', 'Transfer Unit Factor', 'ARS Flag'],
      rows: rows.map((row) => fields.map((field) => row[field] ?? '')),
    } });
  };
  return (
    <Shell
      active="procurement"
      breadcrumb="Procurement > ARS > ARS SKU-Location Link"
      openScreens={[{ label: "ARS SKU-Location Link", to: "#" }]}
    >
      <Bar>
        <Btn variant="warn" onClick={() => void search(1)}>
          <Search size={13} />
          Search
        </Btn>
        <Btn variant="ghost" disabled={!rows.length} onClick={exportRows}>
          <Download size={13} />
          Download visible rows
        </Btn>
        <Btn variant="ghost" onClick={() => nav('/app/admin/common-import?externalImportType=33')}>
          <FileUp size={13} />
          Bulk Import
        </Btn>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw size={13} />
          Reset
        </Btn>
        <Btn variant="ghost" onClick={() => setAdvanced(!advanced)}>
          Advance Search
        </Btn>
        <Btn variant="ghost" onClick={openNew}>
          <Plus size={13} />
          Add New
        </Btn>
        <Btn variant="ghost" onClick={openBulk}>
          Bulk Update
        </Btn>
      </Bar>
      <p className="mb-2 text-xs text-slate-600">Download includes only the rows displayed on this page. A full ARS export job is not configured.</p>
      {advanced && <div className="mb-2 border border-slate-300 bg-white p-3"><Field label="SKU Name"><input aria-label="SKU Name search" className={cls} value={filters.sku_name} onChange={(e) => setFilters({ ...filters, sku_name: e.target.value })} /></Field></div>}
      <div className="overflow-auto border border-slate-300 bg-white">
        <table className="min-w-[1500px] w-full">
          <thead>
            <tr>
              {[
                "Location",
                "SKU",
                "Category",
                "Brand",
                "Primary Vendor",
                "Fullfillment Method",
                "Fullfillment WH",
                "WH Lead Time",
                "Stock cover days",
                "Minimum Transfer Qty",
                "Transfer Unit Factor",
                "ARS Flag",
                "",
                "Maximum SKU Qty",
              ].map((x) => (
                <Th key={x}>{x}</Th>
              ))}
            </tr>
            <tr>
              <th className="border-r border-t p-1"><select multiple aria-label="Location search" className={`${cls} h-9`} value={filters.location} onChange={(e) => setFilters({ ...filters, location: Array.from(e.target.selectedOptions, (option) => option.value) })}>{locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></th>
              <th className="border-r border-t p-1"><input aria-label="SKU search" className={cls} value={filters.sku_code} onChange={(e) => setFilters({ ...filters, sku_code: e.target.value })} /></th>
              <th className="border-r border-t p-1"><button aria-label="Category search" className={`${cls} text-left`} onClick={() => { setHierarchyTarget('search'); setHierarchy(true); }}>{filters.category || "Select..."}</button></th>
              <th className="border-r border-t p-1"><input aria-label="Brand search" className={cls} value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })} /></th>
              <th className="border-r border-t p-1"><input aria-label="Primary Vendor search" className={cls} value={filters.primary_vendor} onChange={(e) => setFilters({ ...filters, primary_vendor: e.target.value })} /></th>
              <th className="border-r border-t p-1"><select aria-label="Fullfillment Method search" className={cls} value={filters.fulfilment_method} onChange={(e) => setFilters({ ...filters, fulfilment_method: e.target.value })}><option value="">--- Select ---</option>{FULFILMENT.map((x) => <option key={x}>{x}</option>)}</select></th>
              <th className="border-r border-t p-1"><select aria-label="Fullfillment WH search" className={cls} value={filters.fulfilment_wh} onChange={(e) => setFilters({ ...filters, fulfilment_wh: e.target.value })}><option value="">--- Select ---</option>{locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></th>
              <th className="border-r border-t p-1"><input aria-label="WH Lead Time search" className={cls} value={filters.wh_lead_time} onChange={(e) => setFilters({ ...filters, wh_lead_time: e.target.value })} /></th>
              <th className="border-r border-t p-1"><input aria-label="Stock cover days search" className={cls} value={filters.stock_cover_days} onChange={(e) => setFilters({ ...filters, stock_cover_days: e.target.value })} /></th>
              <th className="border-r border-t p-1"/><th className="border-r border-t p-1"/>
              <th className="border-r border-t p-1"><select aria-label="ARS Flag search" className={cls} value={filters.ars_flag} onChange={(e) => setFilters({ ...filters, ars_flag: e.target.value })}><option value="">--- Select ---</option><option value="1">Active</option><option value="0">InActive</option></select></th>
              <th className="border-r border-t p-1"/><th className="border-r border-t p-1"/>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Td>Loading ARS links…</Td>
              </tr>
            ) : rows.length ? (
              rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.location}</Td>
                  <Td>
                    <b>{r.sku_code}</b>
                  </Td>
                  <Td>{r.category}</Td>
                  <Td>{r.brand}</Td>
                  <Td>{r.primary_vendor}</Td>
                  <Td>{r.fulfilment_method}</Td>
                  <Td>{r.fulfilment_wh}</Td>
                  <Td>{r.wh_lead_time}</Td>
                  <Td>{r.stock_cover_days}</Td>
                  <Td>{r.minimum_transfer_qty}</Td>
                  <Td>{r.transfer_unit_factor}</Td>
                  <Td>
                    <Status value={r.ars_flag} />
                  </Td>
                  <Td>
                    <button
                      onClick={() => {
                        setEdit(r);
                        setForm({ ...empty, ...r, location: r.location_id || r.location, fulfilment_wh: r.fulfilment_wh_id || r.fulfilment_wh, ars_flag: r.ars_flag === "Active" ? "1" : r.ars_flag === "Inactive" || r.ars_flag === "InActive" ? "0" : r.ars_flag });
                        setShow(true);
                      }}
                      className="text-amber-500"
                    >
                      ✎
                    </button>
                  </Td>
                  <Td>{r.maximum_order_qty}</Td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={14} className="p-8 text-center text-xs text-slate-400">No records to view</td></tr>
            )}
          </tbody>
        </table>
        <div className="border-t p-2 text-right text-[11px] text-slate-500">
          <span>Page {records ? page : 0} of {total}</span>{" "}
          <select aria-label="Records per Page" value={pageSize} onChange={(event) => { const size = Number(event.target.value); setPageSize(size); if (searched) void search(1, size); }}>{[20, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}</select>{" "}
          <button aria-label="Previous page" disabled={!searched || page <= 1} onClick={() => void search(page - 1)}>Previous</button>{" "}
          <button aria-label="Next page" disabled={!total || page >= total} onClick={() => void search(page + 1)}>Next</button>{" "}
          {records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : "No records to view"}
        </div>
      </div>
      <HierarchyPicker
        open={hierarchy}
        onClose={() => setHierarchy(false)}
        onPick={(v) => hierarchyTarget === 'search' ? setFilters({ ...filters, category: v }) : setBulkForm({ ...bulkForm, category: v })}
      />
      <Modal
        title="Create/Update ARS Sku-Location"
        open={show}
        onClose={() => setShow(false)}
      >
        <div className="grid gap-3">
          <Field label="SKU" required>
            <input
              aria-label="SKU"
              className={cls}
              list="ars-sku-options"
              value={form.sku_code}
              disabled={!!edit}
              onChange={(e) => setForm({ ...form, sku_code: e.target.value })}
            />
            <datalist id="ars-sku-options">{skus.map((s) => <option key={s.id} value={s.sku_code}>{s.name}</option>)}</datalist>
          </Field>
          <Field label="SKU Name">
            <input
              aria-label="SKU Name"
              className={`${cls} bg-slate-100`}
              disabled
              value={
                skus.find((s) => s.sku_code === form.sku_code)?.name ||
                edit?.sku_name ||
                ""
              }
            />
          </Field>
          <Field label="SKU-Location Tag">
            <select aria-label="SKU-Location Tag" className={cls} value={form.sku_location_tag} onChange={(e) => setForm({ ...form, sku_location_tag: e.target.value })}>
              <option value="-1">--- Select ---</option>
              {["TAG1", "TAG10", "TAG2", "TAG3", "TAG4", "TAG5", "TAG6", "TAG7", "TAG8", "TAG9"].map((tag) => <option key={tag}>{tag}</option>)}
            </select>
          </Field>
          <Field label="Location" required>
            <select
              aria-label="Location"
              className={cls}
              value={form.location}
              disabled={!!edit}
              onChange={(e) =>
                setForm({
                  ...form,
                  location: e.target.value,
                  fulfilment_wh: e.target.value,
                })
              }
            >
              <option value="">--- Select ---</option>
              {locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Fullfillment Method">
            <select
              aria-label="Fullfillment Method"
              className={cls}
              value={form.fulfilment_method}
              onChange={(e) =>
                setForm({ ...form, fulfilment_method: e.target.value })
              }
            >
              <option value="">--- Select ---</option>
              {FULFILMENT.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Fullfillment WH">
            <select
              aria-label="Fullfillment WH"
              className={cls}
              value={form.fulfilment_wh}
              onChange={(e) =>
                setForm({ ...form, fulfilment_wh: e.target.value })
              }
            >
              <option value="">--- Select ---</option>
              {locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="WH Lead Time(In Days)">
            <input
              aria-label="WH Lead Time(In Days)"
              type="number"
              min="0"
              className={cls}
              value={form.wh_lead_time}
              onChange={(e) =>
                setForm({ ...form, wh_lead_time: e.target.value })
              }
            />
          </Field>
          <Field label="Primary Vendor">
            <div className="flex gap-1"><input aria-label="Primary Vendor" className={cls} value={form.primary_vendor} onChange={(e) => setForm({ ...form, primary_vendor: e.target.value })} /><button aria-label="Open Primary Vendor picker" className="rounded border px-3" onClick={() => { setVendorPickerTarget('editor'); setVendorPicker(true); }}>...</button></div>
          </Field>
          <Field label="Stock cover days">
            <input
              aria-label="Stock cover days"
              type="number"
              min="0"
              className={cls}
              value={form.stock_cover_days}
              onChange={(e) =>
                setForm({ ...form, stock_cover_days: e.target.value })
              }
            />
          </Field>
          <Field label="Minimum Transfer Qty">
            <input aria-label="Minimum Transfer Qty" type="number" className={cls} value={form.minimum_transfer_qty} onChange={(e) => setForm({ ...form, minimum_transfer_qty: e.target.value })} />
          </Field>
          <Field label="Transfer Unit Factor">
            <input aria-label="Transfer Unit Factor" type="number" className={cls} value={form.transfer_unit_factor} onChange={(e) => setForm({ ...form, transfer_unit_factor: e.target.value })} />
          </Field>
          <Field label="ARS Flag" required>
            <select
              aria-label="ARS Flag"
              className={cls}
              value={form.ars_flag}
              onChange={(e) => setForm({ ...form, ars_flag: e.target.value })}
            >
              <option value="">--- Select ---</option>
              <option value="1">Active</option>
              <option value="0">InActive</option>
            </select>
          </Field>
          <Field label="Maximum SKU Qty">
            <input aria-label="Maximum SKU Qty" type="number" className={cls} value={form.maximum_order_qty} onChange={(e) => setForm({ ...form, maximum_order_qty: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={save}>Save</Btn>
          <Btn variant="ghost" onClick={() => setShow(false)}>
            Close
          </Btn>
        </div>
      </Modal>
      <Modal title="Brand List" open={vendorPicker} onClose={() => setVendorPicker(false)} wide>
        <div className="max-h-[430px] overflow-auto border"><table className="w-full"><thead><tr><Th>Vendor</Th><Th>Vendor Name</Th></tr><tr><th className="p-1"><input aria-label="Vendor code filter" className={cls} value={vendorFilter.code} onChange={(e) => setVendorFilter({ ...vendorFilter, code: e.target.value })} /></th><th className="p-1"><input aria-label="Vendor name filter" className={cls} value={vendorFilter.name} onChange={(e) => setVendorFilter({ ...vendorFilter, name: e.target.value })} /></th></tr></thead><tbody>{vendors.filter((v) => (!vendorFilter.code || String(v.vendor_code || "").toLowerCase().includes(vendorFilter.code.toLowerCase())) && (!vendorFilter.name || String(v.vendor_name || "").toLowerCase().includes(vendorFilter.name.toLowerCase()))).map((v) => <tr key={v.id}><Td><button className="text-blue-700 underline" onClick={() => { if (vendorPickerTarget === 'editor') setForm({ ...form, primary_vendor: v.vendor_code }); else if (vendorPickerTarget === 'bulk-filter') setBulkForm({ ...bulkForm, primary_vendor: v.vendor_code }); else setBulkForm({ ...bulkForm, primary_vendor_update: v.vendor_code }); setVendorPicker(false); }}>{v.vendor_code}</button></Td><Td>{v.vendor_name}</Td></tr>)}</tbody></table></div>
        <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setVendorPicker(false)}>Close</Btn><Btn onClick={() => setVendorPicker(false)}>OK</Btn></div>
      </Modal>
      <Modal
        title="Bulk Update"
        open={bulk}
        onClose={() => setBulk(false)}
        wide
      >
        <h3 className="mb-2 border-b pb-2 text-sm font-semibold">Update Filter</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location Type">
            <select
              aria-label="Location Type"
              className={cls}
              value={bulkForm.location_type}
              onChange={(e) =>
                setBulkForm({ ...bulkForm, location_type: e.target.value })
              }
            >
              <option value="-1">--- Select ---</option>
              {LOCATION_TYPES.map((x) => (
                <option key={x.value} value={x.value}>{x.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <select
              className={cls}
              value={bulkForm.location}
              onChange={(e) =>
                setBulkForm({ ...bulkForm, location: e.target.value })
              }
            >
              <option value="-1">--- Select ---</option>
              {locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <div className="flex gap-1"><input className={cls} value={bulkForm.category} readOnly/><button aria-label="Open Bulk Category picker" className="rounded border px-3" onClick={() => { setHierarchyTarget('bulk'); setHierarchy(true); }}>...</button></div>
          </Field>
          <Field label="SKU Group">
            <select className={cls} value={bulkForm.sku_group} onChange={(e) => setBulkForm({ ...bulkForm, sku_group: e.target.value })}><option value="-1">--- Select ---</option>{[...new Set(skus.map((sku) => sku.sku_group).filter(Boolean))].map((group) => <option key={group}>{group}</option>)}</select>
          </Field>
          <Field label="Vendor">
            <div className="flex gap-1"><input className={cls} value={bulkForm.primary_vendor} onChange={(e) => setBulkForm({ ...bulkForm, primary_vendor: e.target.value })}/><button aria-label="Open Bulk Vendor picker" className="rounded border px-3" onClick={() => { setVendorPickerTarget('bulk-filter'); setVendorPicker(true); }}>...</button></div>
          </Field>
          <Field label="Brand">
            <select className={cls} value={bulkForm.brand} onChange={(e) => setBulkForm({ ...bulkForm, brand: e.target.value })}><option value="-1">--- Select ---</option>{[...new Set(skus.map((sku) => sku.brand).filter(Boolean))].map((brand) => <option key={brand}>{brand}</option>)}</select>
          </Field>
          <Field label="SKU">
            <input
              className={cls}
              value={bulkForm.sku_code}
              onChange={(e) =>
                setBulkForm({ ...bulkForm, sku_code: e.target.value })
              }
            />
          </Field>
          <hr className="col-span-2" />
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={bulkForm.add_new} onChange={(e) => setBulkForm({ ...bulkForm, add_new: e.target.checked })}/> Add New</label>
          <Field label="ARS Flag"><div className="flex gap-2"><input aria-label="Update ARS Flag" type="checkbox" {...bulkCheck('ars_flag')}/><select className={cls} value={bulkForm.ars_flag} onChange={(e) => setBulkForm({ ...bulkForm, ars_flag: e.target.value })}><option value="-1">--- Select ---</option><option value="1">Active</option><option value="0">InActive</option></select></div></Field>
          <Field label="Stock Cover Days"><div className="flex gap-2"><input aria-label="Update Stock Cover Days" type="checkbox" {...bulkCheck('stock_cover_days')}/><input className={cls} value={bulkForm.stock_cover_days} onChange={(e) => setBulkForm({ ...bulkForm, stock_cover_days: e.target.value })}/></div></Field>
          <Field label="Primary Vendor"><div className="flex gap-2"><input aria-label="Update Primary Vendor" type="checkbox" {...bulkCheck('primary_vendor_update')}/><input className={cls} value={bulkForm.primary_vendor_update} onChange={(e) => setBulkForm({ ...bulkForm, primary_vendor_update: e.target.value })}/><button aria-label="Open Bulk Primary Vendor picker" className="rounded border px-3" onClick={() => { setVendorPickerTarget('bulk-update'); setVendorPicker(true); }}>...</button></div></Field>
          <Field label="SKU-Location Tag"><div className="flex gap-2"><input aria-label="Update SKU-Location Tag" type="checkbox" {...bulkCheck('sku_location_tag')}/><select className={cls} value={bulkForm.sku_location_tag} onChange={(e) => setBulkForm({ ...bulkForm, sku_location_tag: e.target.value })}><option value="-1">--- Select ---</option>{["TAG1","TAG10","TAG2","TAG3","TAG4","TAG5","TAG6","TAG7","TAG8","TAG9"].map((tag) => <option key={tag}>{tag}</option>)}</select></div></Field>
          <Field label="Is CICO"><div className="flex gap-2"><input aria-label="Update Is CICO" type="checkbox" {...bulkCheck('is_cico')}/><input aria-label="Is CICO value" type="checkbox" checked={bulkForm.is_cico} onChange={(e) => setBulkForm({ ...bulkForm, is_cico: e.target.checked })}/></div></Field>
          <Field label="Case Size"><div className="flex gap-2"><input aria-label="Update Case Size" type="checkbox" {...bulkCheck('case_size')}/><input className={cls} value={bulkForm.case_size} onChange={(e) => setBulkForm({ ...bulkForm, case_size: e.target.value })}/></div></Field>
          <Field label="Fullfillment Method"><div className="flex gap-2"><input aria-label="Update Fullfillment Method" type="checkbox" {...bulkCheck('fulfilment_method')}/><select className={cls} value={bulkForm.fulfilment_method} onChange={(e) => setBulkForm({ ...bulkForm, fulfilment_method: e.target.value })}><option value="-1">--- Select ---</option>{FULFILMENT.map((x) => <option key={x}>{x}</option>)}</select></div></Field>
          <Field label="Fullfillment WH"><div className="flex gap-2"><input aria-label="Update Fullfillment WH" type="checkbox" {...bulkCheck('fulfilment_wh')}/><select className={cls} value={bulkForm.fulfilment_wh} onChange={(e) => setBulkForm({ ...bulkForm, fulfilment_wh: e.target.value })}><option value="-1">--- Select ---</option>{locationOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div></Field>
          <Field label="WH Lead Time(In Days)"><div className="flex gap-2"><input aria-label="Update WH Lead Time" type="checkbox" {...bulkCheck('wh_lead_time')}/><input className={cls} value={bulkForm.wh_lead_time} onChange={(e) => setBulkForm({ ...bulkForm, wh_lead_time: e.target.value })}/></div></Field>
          <Field label="Minimum Transfer Qty"><div className="flex gap-2"><input aria-label="Update Minimum Transfer Qty" type="checkbox" {...bulkCheck('minimum_transfer_qty')}/><input className={cls} value={bulkForm.minimum_transfer_qty} onChange={(e) => setBulkForm({ ...bulkForm, minimum_transfer_qty: e.target.value })}/></div></Field>
          <Field label="Transfer Unit Factor"><div className="flex gap-2"><input aria-label="Update Transfer Unit Factor" type="checkbox" {...bulkCheck('transfer_unit_factor')}/><input className={cls} value={bulkForm.transfer_unit_factor} onChange={(e) => setBulkForm({ ...bulkForm, transfer_unit_factor: e.target.value })}/></div></Field>
          <Field label="Maximum SKU Qty"><div className="flex gap-2"><input aria-label="Update Maximum SKU Qty" type="checkbox" {...bulkCheck('maximum_order_qty')}/><input className={cls} value={bulkForm.maximum_order_qty} onChange={(e) => setBulkForm({ ...bulkForm, maximum_order_qty: e.target.value })}/></div></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={bulkUpdate}>Update</Btn>
          <Btn variant="ghost" onClick={() => setBulk(false)}>
            Close
          </Btn>
        </div>
      </Modal>
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </Shell>
  );
}

export function ARSRules() {
  const nav = useNavigate();
  const { locations: ruleLocations } = useActiveLocations();
  const [routeParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [editing, setEditing] = useState(false);
  const [record, setRecord] = useState<any>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const empty = {
    description: "",
    remarks: "",
    ars_method: "",
    minimum_qty: "",
    maximum_qty: "",
    ros_period: "",
    vendor_type: "",
    output_type: "",
    location: "",
    locations: [] as string[],
    start_date: "",
    end_date: "",
    status: "",
    frequency: "6",
    odd_even: "1",
    schedule_day: "1",
    schedule_weekday: "2",
    schedule_hour: "0",
    days_of_inventory: "",
    sku_sets: [] as any[],
  };
  const [form, setForm] = useState(empty);
  const [locationPicker, setLocationPicker] = useState(false);
  const [skuSetPicker, setSkuSetPicker] = useState(false);
  const [skuSetEdit, setSkuSetEdit] = useState<number | null>(null);
  const [skuSetDraft, setSkuSetDraft] = useState({ operand: "", type: "Brand", value: "" });
  const [showAudit, setShowAudit] = useState(false);
  const [filters, setFilters] = useState({
    location: "",
    product_set: "",
    rule_id: "",
    description: "",
    status: "",
    status_code: "",
    ars_method: "",
    frequency: "",
    last_run_date: "",
    next_run_date: "",
    updated_date: "",
  });
  const loadDependencies = () =>
    Promise.all([
      apiGet<any[]>("/api/ars?entity=links"),
      apiGet<any[]>("/api/ars?entity=settings"),
    ]).then(([l, s]) => {
      setLinks(l);
      setSettings(s[0] || {});
    });
  useEffect(() => {
    void loadDependencies();
  }, []);
  useEffect(() => {
    const ruleId = routeParams.get("ruleId");
    if (!ruleId) return;
    apiGet<any[]>("/api/ars?entity=rules").then((items) => {
      const match = items.find((item) => String(item.rule_id) === ruleId);
      if (match) openEdit(match);
    }).catch(() => undefined);
  }, [routeParams]);
  const search = async (nextPage = 1, nextSize = pageSize) => {
    setLoading(true);
    try {
      const result: any = await apiSend("/api/ars?entity=rules", "POST", {
        entity: "rules",
        REQ_SEARCH_FLAG: true,
        rows: nextSize,
        page: nextPage,
        sidx: "",
        sord: "asc",
        location: filters.location,
        productSet: filters.product_set,
        arsRuleId: filters.rule_id,
        desc: filters.description,
        status: filters.status,
        statusCode: filters.status_code,
        arsMethod: filters.ars_method,
        frequency: filters.frequency,
        lastARSRunDate: filters.last_run_date,
        nextARSRunDate: filters.next_run_date,
        modifiedDateText: filters.updated_date,
        clientId: null,
        client: null,
        frmlastARSRunDate: "",
        tolastARSRunDate: "",
        frmnextARSRunDate: "",
        tonextARSRunDate: "",
      });
      setRows(result.gridModel || result.rows || []);
      setPage(result.page || nextPage);
      setPageSize(nextSize);
      setRecords(result.records || 0);
      setTotal(result.total || 0);
      setSearched(true);
    } catch (error: any) {
      setRows([]);
      setNotice({ msg: error.message, type: "err" });
    } finally {
      setLoading(false);
    }
  };
  const openNew = () => {
    setRecord(null);
    setForm(empty);
    setEditing(true);
    setShowAudit(false);
  };
  const openEdit = (r: any) => {
    const locations =
      Array.isArray(r.locations) && r.locations.length
        ? r.locations
        : [r.location].filter(Boolean);
    setRecord(r);
    setForm({
      ...empty,
      ...r,
      locations,
      location: locations[0] || "",
      frequency: String(r.frequency),
    });
    setEditing(true);
    setShowAudit(false);
  };
  const openSkuSet = (index: number | null = null) => {
    const row = index === null ? null : form.sku_sets[index];
    setSkuSetEdit(index);
    setSkuSetDraft(row ? { operand: row.operand, type: row.type, value: row.value } : { operand: "", type: "Brand", value: "" });
    setSkuSetPicker(true);
  };
  const saveSkuSet = () => {
    if (!skuSetDraft.operand) return setNotice({ msg: "Please Select Type", type: "err" });
    if (!skuSetDraft.value) return setNotice({ msg: "Please Select Value", type: "err" });
    const next = [...form.sku_sets];
    if (skuSetEdit === null) {
      if (next.length >= 50) return setNotice({ msg: "Too Many Record selected", type: "err" });
      next.push(skuSetDraft);
    } else next[skuSetEdit] = skuSetDraft;
    setForm({ ...form, sku_sets: next });
    setSkuSetPicker(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        location: form.locations[0] || "",
        minimum_qty: Number(form.minimum_qty),
        maximum_qty: Number(form.maximum_qty),
        frequency: Number(form.frequency),
      };
      const row: any = record
        ? await apiSend("/api/ars", "PUT", {
            entity: "rules",
            id: record.id,
            ...payload,
          })
        : await apiSend("/api/ars?entity=rules", "POST", {
            entity: "rules",
            ...payload,
          });
      setRecord(row);
      setForm({
        ...form,
        ...row,
        locations: row.locations || [row.location].filter(Boolean),
        frequency: String(row.frequency),
      });
      setNotice({ msg: "ARS Rule created/updated Successfully", type: "ok" });
      if (searched) void search(page);
      return row;
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const row = record || (await save());
    if (!row) return;
    try {
      const updated: any = await apiSend("/api/ars", "PUT", {
        entity: "rules",
        id: row.id,
        action: "confirm",
      });
      setRecord(updated);
      setForm({ ...form, ...updated, frequency: String(updated.frequency) });
      setNotice({ msg: "ARS Rule created/updated Successfully", type: "ok" });
      if (searched) void search(page);
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
    }
  };
  const del = async () => {
    if (!record) return;
    try {
      const updated: any = await apiSend("/api/ars", "PUT", { entity: "rules", id: record.id, status: "InActive" });
      setRecord(updated);
      setForm({ ...form, ...updated, frequency: String(updated.frequency) });
      setNotice({ msg: "ARS Rule Deleted Successfully", type: "ok" });
      if (searched) void search(page);
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
    }
  };
  const periodOptions = [
    settings.ros_lifetime && "Life Time",
    settings.ros_12_weeks && "12 Week",
    settings.ros_6_weeks && "6 Week",
    settings.ros_1_month && "1 Month",
    settings.ros_2_weeks && "2 Weeks",
    ...(settings.custom_periods || []).filter(Boolean).map((x: string) => `${x} Days`),
  ].filter(Boolean) as string[];
  if (editing)
    return (
      <Shell
        active="procurement"
        breadcrumb="Procurement > Setup > ARS Create/Edit"
        openScreens={[
          { label: "ARS Rules", to: "#" },
          { label: "ARS Create/Edit", to: "#" },
        ]}
      >
        <div className="border border-slate-300 bg-white">
          <Bar>
            <Btn
              variant="ghost"
              onClick={() => nav(`/app/procurement/ars/logs${record ? `?ruleId=${record.rule_id}` : ""}`)}
            >
              <History size={13} />
              View Log
            </Btn>
            <Btn variant="warn" disabled={busy} onClick={save}>
              Save
            </Btn>
            <Btn
              disabled={busy}
              onClick={confirm}
            >
              Confirm
            </Btn>
            <Btn variant="ghost" onClick={openNew}>
              Add New
            </Btn>
          </Bar>
          <p className="px-3 pb-2 text-xs text-amber-800">ARS Run Now is unavailable until purchase-order creation is idempotent and Sales History rules use recorded sales data.</p>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 border-t p-4 lg:grid-cols-[1fr_1fr_220px]">
            <div className="grid gap-3">
              <Field label="Rule ID">
                <input
                  className={`${cls} bg-slate-100`}
                  disabled
                  value={record?.rule_id || ""}
                />
              </Field>
              <Field label="ARS Method" required>
                <select
                  className={cls}
                  value={form.ars_method}
                  onChange={(e) =>
                    setForm({ ...form, ars_method: e.target.value })
                  }
                >
                  <option value="">--- Select ---</option>
                  {RULE_METHODS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Output Type" required>
                <select
                  className={cls}
                  value={form.output_type}
                  onChange={(e) =>
                    setForm({ ...form, output_type: e.target.value })
                  }
                >
                  <option value="">--- Select ---</option>
                  {OUTPUT_TYPES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  className={cls}
                  value={form.end_date}
                  onChange={(e) =>
                    setForm({ ...form, end_date: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3">
              <Field label="Rule Description" required>
                <input
                  className={cls}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Vendor Type" required>
                <select
                  className={cls}
                  value={form.vendor_type}
                  onChange={(e) =>
                    setForm({ ...form, vendor_type: e.target.value })
                  }
                >
                  <option value="">--- Select ---</option>
                  {VENDOR_TYPES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Location" required>
                <div className="flex">
                  <input className={cls} readOnly value={form.locations.length ? `${form.locations.length} Selected` : ""} />
                  <button aria-label="Select Location" className="border px-3" onClick={() => setLocationPicker(true)}>...</button>
                </div>
              </Field>
              <Field label="Status" required>
                <select
                  className={cls}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="">--- Select ---</option>
                  {ARS_STATUS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            <aside className="row-span-2 border-l pl-3 text-xs text-slate-500">
              <b className="block border-b bg-slate-100 p-2 text-center">
                ARS Details
              </b>
              <p className="p-2">
                Last Run Date
                <br />
                <b>{record?.last_run_date || "—"}</b>
              </p>
              <p className="p-2">
                Next Run Date
                <br />
                <b>{record?.next_run_date || "—"}</b>
              </p>
              <button onClick={() => setShowAudit((value) => !value)} className="w-full border bg-slate-100 p-2">Audit</button>
              {showAudit && <div className="space-y-2 border p-2"><p>Created By<br/><b>{record?.created_by || "—"}</b></p><p>Created Date<br/><b>{record?.created_date || "—"}</b></p><p>Updated By<br/><b>{record?.updated_by || "—"}</b></p><p>Updated Date<br/><b>{record?.updated_date || "—"}</b></p></div>}
            </aside>
            <div className="grid gap-3">
              <Field
                label="Min"
                required={form.ars_method === "Min-Max"}
              >
                <input
                  disabled={form.ars_method !== "Min-Max"}
                  type="number"
                  min="0"
                  className={cls}
                  value={form.minimum_qty}
                  onChange={(e) =>
                    setForm({ ...form, minimum_qty: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Max"
                required={form.ars_method === "Min-Max"}
              >
                <input
                  disabled={form.ars_method !== "Min-Max"}
                  type="number"
                  min="0"
                  className={cls}
                  value={form.maximum_qty}
                  onChange={(e) =>
                    setForm({ ...form, maximum_qty: e.target.value })
                  }
                />
              </Field>
              <Field
                label="ROS Period"
                required={form.ars_method === "Sales History"}
              >
                <select
                  disabled={form.ars_method !== "Sales History"}
                  className={cls}
                  value={form.ros_period}
                  onChange={(e) =>
                    setForm({ ...form, ros_period: e.target.value })
                  }
                >
                  <option value="">--- Select ---</option>
                  {periodOptions.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-3">
              <Field label="Remarks">
                <textarea
                  className={cls}
                  rows={3}
                  value={form.remarks}
                  onChange={(e) =>
                    setForm({ ...form, remarks: e.target.value })
                  }
                />
              </Field>
              <Field label="Start Date" required>
                <input
                  type="date"
                  className={cls}
                  value={form.start_date}
                  onChange={(e) =>
                    setForm({ ...form, start_date: e.target.value })
                  }
                />
              </Field>
              <Field label="Frequency" required>
                <select
                  className={cls}
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value })
                  }
                >
                  {FREQUENCIES.map((x) => (
                    <option key={x.v} value={x.v}>
                      {x.l}
                    </option>
                  ))}
                </select>
              </Field>
              {(form.frequency === "1" || form.frequency === "2") && <Field label="Day"><select className={cls} value={form.schedule_day} onChange={(e) => setForm({ ...form, schedule_day: e.target.value })}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></Field>}
              {(form.frequency === "3" || form.frequency === "4") && <Field label="Week"><select className={cls} value={form.schedule_weekday} onChange={(e) => setForm({ ...form, schedule_weekday: e.target.value })}>{[["2", "Monday"], ["3", "Tuesday"], ["4", "Wednesday"], ["5", "Thursday"], ["6", "Friday"], ["7", "Saturday"], ["1", "Sunday"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
              {(form.frequency === "2" || form.frequency === "4") && <Field label={form.frequency === "2" ? "Month" : "Week Type"}><select className={cls} value={form.odd_even} onChange={(e) => setForm({ ...form, odd_even: e.target.value })}><option value="1">Every Odd {form.frequency === "2" ? "Month" : "Week"}</option><option value="2">Every Even {form.frequency === "2" ? "Month" : "Week"}</option></select></Field>}
              {form.frequency !== "6" && <Field label="Hour"><select className={cls} value={form.schedule_hour} onChange={(e) => setForm({ ...form, schedule_hour: e.target.value })}>{Array.from({ length: 24 }, (_, i) => <option key={i}>{i}</option>)}</select></Field>}
            </div>
          </div>
          <div className="border-t p-3">
            <button
              onClick={() => openSkuSet()}
              className="mb-2 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
            >
              ＋ Add SKU Set
            </button>
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Operand</Th>
                  <Th>Value</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {form.sku_sets.map((s: any, i: number) => (
                  <tr key={i}>
                    <Td>{s.operand}</Td>
                    <Td>{s.type}</Td>
                    <Td>{s.value}</Td>
                    <Td>
                      <button aria-label={`View SKU Set ${i + 1}`} onClick={() => openSkuSet(i)} className="mr-3 text-emerald-600">ⓘ</button>
                      <button
                        onClick={() =>
                          setForm({
                            ...form,
                            sku_sets: form.sku_sets.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          })
                        }
                        className="text-rose-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Modal title="Location Pick List" open={locationPicker} onClose={() => setLocationPicker(false)} wide>
          <div className="max-h-80 overflow-auto border p-2">{ruleLocations.map((location) => <label key={location.location_code} className="block border-b p-2"><input type="checkbox" checked={form.locations.includes(location.location_name)} onChange={() => setForm({ ...form, locations: form.locations.includes(location.location_name) ? form.locations.filter((value: string) => value !== location.location_name) : [...form.locations, location.location_name] })} /> {location.location_name} ({location.location_code})</label>)}{!ruleLocations.length && <p className="p-2 text-sm text-slate-500">No active locations configured.</p>}</div>
          <div className="mt-3 flex justify-end gap-2"><Btn onClick={() => setLocationPicker(false)}>OK</Btn><Btn variant="ghost" onClick={() => setLocationPicker(false)}>Close</Btn></div>
        </Modal>
        <Modal title="Add SKU Set" open={skuSetPicker} onClose={() => setSkuSetPicker(false)} wide>
          <div className="grid gap-3"><Field label="Type" required><select aria-label="SKU Set Type" className={cls} value={skuSetDraft.operand} onChange={(e) => setSkuSetDraft({ ...skuSetDraft, operand: e.target.value })}><option value="">--- Select ---</option><option>Exclude</option><option>Include</option></select></Field><Field label="Operand" required><select aria-label="SKU Set Operand" className={cls} value={skuSetDraft.type} onChange={(e) => setSkuSetDraft({ ...skuSetDraft, type: e.target.value, value: "" })}>{SKU_SET_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Value" required><select aria-label="SKU Set Value" className={cls} value={skuSetDraft.value} onChange={(e) => setSkuSetDraft({ ...skuSetDraft, value: e.target.value })}><option value="">--- Select ---</option>{Array.from(new Set(links.map((row: any) => skuSetDraft.type === "SKU" ? row.sku_code : skuSetDraft.type === "Brand" ? row.brand : skuSetDraft.type === "Vendor" ? row.primary_vendor : skuSetDraft.type === "Hierarchy" ? row.category : row.sku_group).filter(Boolean))).map((x: any) => <option key={x}>{x}</option>)}</select></Field></div>
          <div className="mt-4 flex justify-end gap-2"><Btn onClick={saveSkuSet}>OK</Btn><Btn variant="ghost" onClick={() => setSkuSetPicker(false)}>Close</Btn></div>
        </Modal>
        {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
      </Shell>
    );
  const reset = () => {
    setFilters({
      location: "",
      product_set: "",
      rule_id: "",
      description: "",
      status: "",
      status_code: "",
      ars_method: "",
      frequency: "",
      last_run_date: "",
      next_run_date: "",
      updated_date: "",
    });
    setRows([]);
    setPage(1);
    setRecords(0);
    setTotal(0);
    setSearched(false);
  };
  return (
    <Shell
      active="procurement"
      breadcrumb="Procurement > Setup > ARS Rules"
      openScreens={[{ label: "ARS Rules", to: "#" }]}
    >
      <Bar>
        <Btn variant="warn" disabled={loading} onClick={() => void search(1)}>
          <Search size={13} />
          Search
        </Btn>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw size={13} />
          Reset
        </Btn>
        <Btn variant="ghost" onClick={openNew}>
          <Plus size={13} />
          Add New
        </Btn>
      </Bar>
      <div className="grid grid-cols-2 gap-4 border border-slate-300 bg-white p-3">
        <Field label="Location">
          <select
            className={cls}
            value={filters.location}
            onChange={(e) =>
              setFilters({ ...filters, location: e.target.value })
            }
          >
            <option value="">--- Select ---</option>
            {ruleLocations.map((row: any) => { const value = row.location_name; return <option key={row.location_code} value={value}>{value} ({row.location_code})</option>; })}
          </select>
        </Field>
        <Field label="Product Set">
          <select
            className={cls}
            value={filters.product_set}
            onChange={(e) =>
              setFilters({ ...filters, product_set: e.target.value })
            }
          >
            <option value="">--- Select ---</option>
            {SKU_SET_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
      </div>
      <table className="mt-2 w-full border border-slate-300 bg-white">
        <thead>
          <tr>
            {[
              "Rule ID",
              "Description",
              "Status",
              "ARS Method",
              "Frequency",
              "Last Run Date",
              "Next Run Date",
              "Created By",
              "Updated By",
              "Updated Date",
            ].map((x) => (
              <Th key={x}>{x}</Th>
            ))}
          </tr>
          <tr>
            {["rule_id", "description"].map((k) => (
              <th key={k} className="p-1">
                <input
                  className={cls}
                  value={(filters as any)[k]}
                  onChange={(e) =>
                    setFilters({ ...filters, [k]: e.target.value })
                  }
                />
              </th>
            ))}
            <th className="p-1">
              <select className={cls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">--- Select ---</option>
                {ARS_STATUS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </th>
            <th className="p-1">
              <select className={cls} value={filters.ars_method} onChange={(e) => setFilters({ ...filters, ars_method: e.target.value })}>
                <option value="">--- Select ---</option>
                {RULE_METHODS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </th>
            <th className="p-1">
              <select className={cls} value={filters.frequency} onChange={(e) => setFilters({ ...filters, frequency: e.target.value })}>
                <option value="">--- Select ---</option>
                {['Never', 'Bimonthly', 'Monthly', 'Biweekly', 'Weekly', 'Daily'].map((value) => <option key={value}>{value}</option>)}
              </select>
            </th>
            {['last_run_date', 'next_run_date'].map((key) => (
              <th key={key} className="p-1"><input className={cls} value={(filters as any)[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} /></th>
            ))}
            <th /><th />
            <th className="p-1"><input className={cls} value={filters.updated_date} onChange={(e) => setFilters({ ...filters, updated_date: e.target.value })} /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onDoubleClick={() => openEdit(r)}>
              <Td>
                <button className="text-sky-600" onClick={() => openEdit(r)}>
                  {r.rule_id}
                </button>
              </Td>
              <Td>{r.description}</Td>
              <Td>
                <Status value={r.status} />
              </Td>
              <Td>{r.ars_method}</Td>
              <Td>
                {FREQUENCIES.find((x) => Number(x.v) === Number(r.frequency))
                  ?.l || `${r.frequency} Hours`}
              </Td>
              <Td>{r.last_run_date || "—"}</Td>
              <Td>{r.next_run_date || "—"}</Td>
              <Td>{r.created_by}</Td>
              <Td>{r.updated_by}</Td>
              <Td>{r.updated_date}</Td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={10} className="p-8 text-center text-xs text-slate-400">No records to view</td></tr>
          )}
          {loading && (
            <tr><td colSpan={10} className="p-8 text-center text-xs text-slate-400">Loading...</td></tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border border-t-0 bg-white p-2 text-xs text-slate-500">
        <span>Page {records ? page : 0} of {total}</span>
        <span>
          <button disabled={!records || page <= 1 || loading} onClick={() => void search(page - 1)}>Previous</button>{" "}
          <select aria-label="Records per Page" value={pageSize} onChange={(event) => { const size = Number(event.target.value); setPageSize(size); if (searched) void search(1, size); }}>
            {[20, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}
          </select>{" "}
          <button disabled={!records || page >= total || loading} onClick={() => void search(page + 1)}>Next</button>
        </span>
        <span>{records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : "No records to view"}</span>
      </div>
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </Shell>
  );
}

export function ARSExecutionLog() {
  const nav = useNavigate();
  const { requestDownload } = useDownload();
  const [routeParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    execution_id: "",
    rule_id: "",
    location: "",
    status: "",
    exec_time: "",
    rule_desc: "",
    frequency: "",
    vendor_type: "",
    output_type: "",
  });
  const [detail, setDetail] = useState<any>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const [picker, setPicker] = useState<"rule" | "execution" | null>(null);
  const [pickerRows, setPickerRows] = useState<any[]>([]);
  const [statusDetail, setStatusDetail] = useState<any>(null);
  const search = async (nextPage = 1, nextSize = pageSize) => {
    setLoading(true);
    try {
      const result: any = await apiSend("/api/ars?entity=logs", "POST", {
        entity: "logs", REQ_SEARCH_FLAG: true, rows: nextSize, page: nextPage, sidx: "", sord: "asc", clientId: null,
        location: filters.location, arsExecId: filters.execution_id, execTime: filters.exec_time, frmExecTime: "", toExecTime: "",
        ruleId: filters.rule_id, ruleDesc: filters.rule_desc, frequency: filters.frequency, vendorType: filters.vendor_type,
        outputType: filters.output_type, status: filters.status,
      });
      setRows(result.gridModel || result.rows || []); setPage(result.page || nextPage); setPageSize(nextSize);
      setRecords(result.records || 0); setTotal(result.total || 0); setSearched(true);
    } catch (error: any) { setRows([]); setNotice({ msg: error.message, type: "err" }); } finally { setLoading(false); }
  };
  const reset = () => {
    setFilters({ execution_id: "", rule_id: "", location: "", status: "", exec_time: "", rule_desc: "", frequency: "", vendor_type: "", output_type: "" });
    setRows([]); setPage(1); setRecords(0); setTotal(0); setSearched(false);
  };
  const openPicker = async (kind: "rule" | "execution") => {
    try { setPickerRows(await apiGet<any[]>(`/api/ars?entity=${kind === "rule" ? "rules" : "logs"}`)); setPicker(kind); }
    catch (error: any) { setNotice({ msg: error.message, type: "err" }); }
  };
  useEffect(() => {
    apiGet<any>("/api/locations").then((data) => setLocations(data.rows || [])).catch(() => undefined);
    const ruleId = routeParams.get("ruleId") || "";
    const executionId = routeParams.get("executionId") || "";
    if (ruleId || executionId) setFilters((current) => ({ ...current, rule_id: ruleId, execution_id: executionId }));
    void search(1);
  }, []);
  const downloadDetail = () => {
    if (!detail?.execution_details?.length) return setNotice({ msg: "No data in grid to export", type: "err" });
    requestDownload({ title: "ARS Execution Detail Log", module: "ARS Execution Detail Log", baseName: `ars-execution-${detail.execution_id}`, data: { columns: ["Location", "SKU", "Vendor", "Inventory", "ARS Calc", "ARS Approved", "Status", "Doc Generated"], rows: detail.execution_details.map((row: any) => [row.location, row.sku_code, row.vendor, row.inventory, row.ars_calculated, row.ars_approved, row.status, row.document_generated]) } });
  };
  if (detail) return <Shell active="procurement" breadcrumb="Procurement > ARS > ARS Execution Detail Log" openScreens={[{ label: "ARS Execution Log", to: "#" }, { label: "ARS Execution Detail Log", to: "#" }]}>
    <Bar><Btn variant="ghost" onClick={downloadDetail}>Download visible detail</Btn><Btn variant="ghost" onClick={() => setDetail(null)}>Reset</Btn></Bar>
    <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">This is a stored legacy execution log. Approval and processing are unavailable until their purchase-order job and permissions are connected and verified.</p>
    <div className="grid grid-cols-2 gap-4 border bg-white p-3"><Field label="Rule ID"><input className={cls} readOnly value={detail.rule_id || ""}/></Field><Field label="Execution ID"><input className={cls} readOnly value={detail.execution_id || ""}/></Field></div>
    <button className="my-2 text-xs text-sky-600 underline" onClick={() => setStatusDetail(detail)}>For Information regarding all attributes and ARS calculation. Please Click Here.</button>
    <table className="w-full bg-white"><thead><tr>{["Location", "SKU", "Vendor", "Inventory", "ARS Calc", "ARS Approved", "Status", "Doc Generated"].map((value) => <Th key={value}>{value}</Th>)}</tr></thead><tbody>{(detail.execution_details || []).map((row: any, index: number) => <tr key={index}><Td>{row.location}</Td><Td>{row.sku_code}</Td><Td>{row.vendor}</Td><Td>{row.inventory}</Td><Td>{row.ars_calculated}</Td><Td>{row.ars_approved}</Td><Td><button className="text-sky-600" onClick={() => setStatusDetail(row)}>{row.status}</button></Td><Td>{row.document_generated ? <button className="text-sky-600" onClick={() => nav(`/app/procurement/purchase-orders?poNo=${row.document_generated}`)}>{row.document_generated}</button> : ""}</Td></tr>)}</tbody></table>
    <Modal title="ARS Execution Status" open={!!statusDetail} onClose={() => setStatusDetail(null)}><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(statusDetail, null, 2)}</pre></Modal>
    {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
  </Shell>;
  return (
    <Shell
      active="procurement"
      breadcrumb="Procurement > ARS > ARS Execution Log"
      openScreens={[{ label: "ARS Execution Log", to: "#" }]}
    >
      <Bar>
        <Btn variant="warn" disabled={loading} onClick={() => void search(1)}>
          <Search size={13} />
          Search
        </Btn>
        <Btn
          variant="ghost"
          onClick={reset}
        >
          <RotateCcw size={13} />
          Reset
        </Btn>
      </Bar>
      <div className="grid grid-cols-2 gap-4 border bg-white p-3">
        <Field label="Rule ID"><span className="flex"><input aria-label="Rule ID" className={cls} value={filters.rule_id} onChange={(e) => setFilters({ ...filters, rule_id: e.target.value })}/><button aria-label="Rule ID Picker" className="border px-3" onClick={() => void openPicker("rule")}>...</button></span></Field>
        <Field label="Execution ID"><span className="flex"><input aria-label="Execution ID" className={cls} value={filters.execution_id} onChange={(e) => setFilters({ ...filters, execution_id: e.target.value })}/><button aria-label="Execution ID Picker" className="border px-3" onClick={() => void openPicker("execution")}>...</button></span></Field>
      </div>
      <table className="mt-2 w-full bg-white">
        <thead>
          <tr>
            {[
              "Location",
              "Execution ID",
              "Exec Time",
              "Rule Name",
              "Frequency",
              "Vendor Type",
              "Output Type",
              "Status",
            ].map((x) => (
              <Th key={x}>{x}</Th>
            ))}
          </tr>
          <tr>
            <th className="p-1"><select aria-label="Location" className={cls} value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })}><option value="">--- Select ---</option>{locations.map((row: any) => { const value = row.location_name || row.name || row.location_code || row.code; return <option key={row.id || value} value={value}>{value}</option>; })}</select></th>
            <th className="p-1" />
            <th className="p-1"><input className={cls} value={filters.exec_time} onChange={(e) => setFilters({ ...filters, exec_time: e.target.value })}/></th>
            <th className="p-1"><input className={cls} value={filters.rule_desc} onChange={(e) => setFilters({ ...filters, rule_desc: e.target.value })}/></th>
            <th className="p-1"><select className={cls} value={filters.frequency} onChange={(e) => setFilters({ ...filters, frequency: e.target.value })}><option value="">--- Select ---</option>{['Never','Bimonthly','Monthly','Biweekly','Weekly','Daily'].map((value) => <option key={value}>{value}</option>)}</select></th>
            <th className="p-1"><select className={cls} value={filters.vendor_type} onChange={(e) => setFilters({ ...filters, vendor_type: e.target.value })}><option value="">--- Select ---</option>{['Min Cost','Min Lead Tim','Primary'].map((value) => <option key={value}>{value}</option>)}</select></th>
            <th className="p-1"><select className={cls} value={filters.output_type} onChange={(e) => setFilters({ ...filters, output_type: e.target.value })}><option value="">--- Select ---</option>{OUTPUT_TYPES.map((value) => <option key={value}>{value}</option>)}</select></th>
            <th className="p-1"><select className={cls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">--- Select ---</option>{['Pending','InProcess','ARS Generated','Approved','Document Generated','Zero Qty','Document Inprocess','Error'].map((value) => <option key={value}>{value}</option>)}</select></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.location}</Td>
              <Td>
                <button onClick={() => setDetail(r)} className="text-sky-600">
                  {r.arsExecId}
                </button>
              </Td>
              <Td>{r.execTime ? new Date(r.execTime).toLocaleString() : ""}</Td>
              <Td><button className="text-sky-600" onClick={() => nav(`/app/procurement/ars/rules?ruleId=${r.rule_id}`)}>{r.ruleDesc}</button></Td><Td>{r.frequencyDesc}</Td><Td>{r.vendorTypeDesc}</Td><Td>{r.outPutTypeDesc}</Td>
              <Td>
                <button onClick={() => setStatusDetail(r)}><Status value={r.statusDesc} /></button>
              </Td>
            </tr>
          ))}
          {!loading && !rows.length && <tr><td colSpan={8} className="p-8 text-center text-xs text-slate-400">No records to view</td></tr>}
          {loading && <tr><td colSpan={8} className="p-8 text-center text-xs text-slate-400">Loading...</td></tr>}
        </tbody>
      </table>
      <div className="flex items-center justify-between border border-t-0 bg-white p-2 text-xs text-slate-500">
        <span>Page {records ? page : 0} of {total}</span><span><button disabled={!records || page <= 1 || loading} onClick={() => void search(page - 1)}>Previous</button>{" "}<select aria-label="Records per Page" value={pageSize} onChange={(e) => { const size = Number(e.target.value); setPageSize(size); if (searched) void search(1, size); }}>{[20,50,100,200].map((size) => <option key={size}>{size}</option>)}</select>{" "}<button disabled={!records || page >= total || loading} onClick={() => void search(page + 1)}>Next</button></span>
        <span>{records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : "No records to view"}</span>
      </div>
      <Modal title={picker === "rule" ? "ARS Rule Pick List" : "ARS Execution Pick List"} open={!!picker} onClose={() => setPicker(null)}>
        <div className="max-h-72 overflow-auto">{pickerRows.map((row) => { const value = picker === "rule" ? row.rule_id : row.execution_id; return <button key={row.id} className="block w-full border-b p-2 text-left text-xs" onClick={() => { setFilters({ ...filters, [picker === "rule" ? "rule_id" : "execution_id"]: value }); setPicker(null); }}>{value} — {row.description}</button>; })}</div>
      </Modal>
      <Modal
        title={`ARS Execution — ${detail?.execution_id || ""}`}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        <p className="text-sm text-slate-600">{detail?.message}</p>
        <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">
          Generated Purchase Orders
        </h3>
        {detail?.generated_po_codes?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-sky-600">
            {detail.generated_po_codes.map((x: string) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            No Purchase Orders generated.
          </p>
        )}
      </Modal>
      <Modal title="ARS Execution Status" open={!!statusDetail} onClose={() => setStatusDetail(null)}><div className="space-y-2 text-sm"><p><b>Execution ID:</b> {statusDetail?.execution_id || statusDetail?.arsExecId}</p><p><b>Location:</b> {statusDetail?.location}</p><p><b>Status:</b> {statusDetail?.statusDesc || statusDetail?.status}</p><p>{statusDetail?.message}</p></div></Modal>
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </Shell>
  );
}

export function ARSSettings() {
  const [form, setForm] = useState<any>({
    enable_ars: true,
    calculation_hour: 2,
    ros_lifetime: true,
    ros_12_weeks: true,
    ros_6_weeks: false,
    ros_1_month: false,
    ros_2_weeks: false,
    custom_periods: ["", "", ""],
    custom_period_enabled: [false, false, false],
    puf_tuf: "1",
  });
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    apiGet<any[]>("/api/ars?entity=settings").then(
      (r) => r[0] && setForm(r[0]),
    );
  }, []);
  const save = async () => {
    try {
      const enabled = form.custom_period_enabled || [false, false, false];
      for (let index = 0; index < 3; index += 1) {
        if (enabled[index] && !String(form.custom_periods?.[index] || "").trim()) throw new Error("Please Enter Days in Textbox to Make it Active.");
        const value = String(form.custom_periods?.[index] || "").trim();
        if (value && (!/^\d+$/.test(value) || Number(value) < 2 || Number(value) > 365)) throw new Error("Please Enter Days between 2 and 365");
      }
      const activeRos = [form.ros_lifetime, form.ros_12_weeks, form.ros_6_weeks, form.ros_1_month, form.ros_2_weeks, ...enabled].filter(Boolean).length;
      if (form.enable_ars && activeRos < 2) throw new Error("Minimum 2 ROS Calculation parameters should be Active");
      const r = await apiSend("/api/ars", "PUT", {
        entity: "settings",
        ...form,
      });
      setForm(r);
      setNotice({ msg: "Configuration updated Successfully", type: "ok" });
    } catch (e: any) {
      setNotice({ msg: e.message, type: "err" });
    }
  };
  const toggle = (key: string) => (
    <button
      onClick={() => setForm({ ...form, [key]: !form[key] })}
      className={`w-14 rounded-sm px-2 py-1 text-xs font-semibold text-white ${form[key] ? "bg-emerald-500" : "bg-rose-500"}`}
    >
      {form[key] ? "ON" : "OFF"}
    </button>
  );
  return (
    <Shell
      active="admin"
      breadcrumb="Admin > Setting > B2B Configuration"
      openScreens={[{ label: "B2B Configuration", to: "#" }]}
    >
      <div className="border bg-white">
        <div className="flex justify-end p-2">
          <Btn variant="warn" onClick={save}>
            Save
          </Btn>
        </div>
        <section className="border-t p-5">
          <h2 className="border-b-4 border-cyan-600 pb-1 text-sm font-semibold text-slate-600">
            ARS Setting
          </h2>
          <div className="mx-auto mt-4 grid max-w-lg gap-3">
            <Field label="Enable ARS">{toggle("enable_ars")}</Field>
            <Field label="ROS Calculation Hour">
              <select
                className={cls}
                value={form.calculation_hour}
                onChange={(e) =>
                  setForm({ ...form, calculation_hour: Number(e.target.value) })
                }
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </Field>
            <Field label="PUF/TUF">
              <select className={cls} value={form.puf_tuf || "1"} onChange={(e) => setForm({ ...form, puf_tuf: e.target.value })}><option value="1">Round Up</option><option value="2">Round Down</option></select>
            </Field>
          </div>
        </section>
        <section className="p-5">
          <h2 className="border-b-4 border-cyan-600 pb-1 text-sm font-semibold text-slate-600">
            Calculate ROS
          </h2>
          <div className="mx-auto mt-4 grid max-w-lg gap-3">
            {[
              ["ros_lifetime", "Life Time"],
              ["ros_12_weeks", "12 Weeks"],
              ["ros_6_weeks", "6 Weeks"],
              ["ros_1_month", "1 Month"],
              ["ros_2_weeks", "2 Weeks"],
            ].map(([k, l]) => (
              <Field key={k} label={l}>
                {toggle(k)}
              </Field>
            ))}
            {(form.custom_periods || ["", "", ""]).map(
              (v: string, i: number) => (
                <Field key={i} label="Custom Period">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`Custom Period ${i + 1} Active`} checked={!!form.custom_period_enabled?.[i]} onChange={(e) => { const active = [...(form.custom_period_enabled || [false, false, false])]; active[i] = e.target.checked; const periods = [...form.custom_periods]; if (!e.target.checked) periods[i] = ""; setForm({ ...form, custom_period_enabled: active, custom_periods: periods }); }} />
                    <input
                      type="number"
                      aria-label={`Custom Period ${i + 1} Days`}
                      className={cls}
                      disabled={!form.custom_period_enabled?.[i]}
                      value={v}
                      onChange={(e) => {
                        const a = [...form.custom_periods];
                        a[i] = e.target.value;
                        setForm({ ...form, custom_periods: a });
                      }}
                    />
                    <span>Days</span>
                  </span>
                </Field>
              ),
            )}
          </div>
        </section>
      </div>
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </Shell>
  );
}
