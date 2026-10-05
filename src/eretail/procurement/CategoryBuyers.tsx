import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Shell from "../Shell";
import Modal from "../../components/Modal";
import { apiGet, apiSend } from "../../lib/api";

const SIZES = [20, 50, 100, 200];
const emptyFilters = {
  buyerName: "",
  buyerDesc: "",
  phone: "",
  altPhone: "",
  email: "",
  displayIsActive: "-1",
  linkToCategory: [] as string[],
};
const blank = () => ({
  buyer_code: "",
  buyer_name: "",
  description: "",
  email: "",
  phone: "",
  alternate_phone: "",
  active: false,
  categories: [] as string[],
  udf: ["", "", "", "", ""],
  location: "",
  created_by: "",
  created_date: "",
  updated_by: "",
  updated_date: "",
});
type Buyer = ReturnType<typeof blank> & {
  id?: number;
  displayIsActive?: string;
  linkToCategory?: string;
};
type BuyerRow = Partial<Buyer> & {
  buyerCode?: string | number; buyerName?: string; buyerDesc?: string;
  altPhone?: string; isActive?: boolean; linkToCategory?: string;
  udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string;
  locationCode?: string; createdBy?: string; createDate?: string;
  modifiedBy?: string; modifiedDate?: string;
};
type BuyerSearchResult = { gridModel?: BuyerRow[]; categoryBuyerDTOs?: BuyerRow[]; page: number; total: number; records: number };
type CatalogRow = { code: string; name: string };
type LocationRow = { location_code: string; location_name: string };
const fromLiveRow = (row: BuyerRow): Buyer => ({
  ...blank(),
  buyer_code: String(row.buyerCode ?? row.buyer_code ?? ""),
  buyer_name: row.buyerName ?? row.buyer_name ?? "",
  description: row.buyerDesc ?? row.description ?? "",
  phone: row.phone ?? "",
  alternate_phone: row.altPhone ?? row.alternate_phone ?? "",
  email: row.email ?? "",
  active: row.isActive ?? row.active ?? false,
  categories: Array.isArray(row.categories) ? row.categories : String(row.linkToCategory || "").split("\u0017").filter(Boolean),
  udf: row.udf || [row.udf1, row.udf2, row.udf3, row.udf4, row.udf5].map((value) => value || ""),
  location: row.locationCode ?? row.location ?? "",
  created_by: row.createdBy ?? row.created_by ?? "",
  created_date: row.createDate ?? row.created_date ?? "",
  updated_by: row.modifiedBy ?? row.updated_by ?? "",
  updated_date: row.modifiedDate ?? row.updated_date ?? "",
  displayIsActive: row.displayIsActive ?? (row.active === false ? "Inactive" : "Active"),
  linkToCategory: row.linkToCategory ?? "",
});

export default function CategoryBuyers() {
  const [filters, setFilters] = useState(emptyFilters);
  const [rows, setRows] = useState<Buyer[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Buyer>(blank());
  const [categories, setCategories] = useState<{ code: string; name: string }[]>([]);
  const [locations, setLocations] = useState<{ code: string; name: string }[]>([]);
  const [editorTab, setEditorTab] = useState<"edit" | "udf">("edit");
  const [audit, setAudit] = useState<Buyer | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiGet<{ rows: CatalogRow[] }>("/api/merch-hierarchy")
      .then((data) => setCategories((data.rows || []).map((row) => ({ code: row.code, name: row.name }))))
      .catch(() => setCategories([]));
    apiGet<{ rows: LocationRow[] }>("/api/locations")
      .then((data) => setLocations((data.rows || []).map((row) => ({ code: row.location_code, name: row.location_name })).filter((row) => row.code && row.name)))
      .catch((error: Error) => setNotice(error.message));
  }, []);
  const set = (key: keyof typeof emptyFilters, value: string | string[]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const search = async (nextPage = 1, nextSize = size, nextFilters = filters) => {
    setLoading(true);
    setNotice("");
    try {
      const result = await apiSend<BuyerSearchResult>("/api/categoryBuyerSearch", "POST", {
        _search: true,
        rows: nextSize,
        page: nextPage,
        sidx: "",
        sord: "asc",
        buyerName: nextFilters.buyerName,
        buyerDesc: nextFilters.buyerDesc,
        phone: nextFilters.phone,
        altPhone: nextFilters.altPhone,
        email: nextFilters.email,
        isActive: nextFilters.displayIsActive,
        udf1: "",
        udf2: "",
        udf3: "",
        udf4: "",
        udf5: "",
        linkToCat: nextFilters.linkToCategory.join("\u0017"),
        REQ_SEARCH_FLAG: true,
      });
      setRows((result.gridModel || result.categoryBuyerDTOs || []).map(fromLiveRow));
      setPage(result.page);
      setTotal(result.total);
      setRecords(result.records);
      setSize(nextSize);
      setSearched(true);
    } catch (error) {
      setRows([]);
      setNotice(error instanceof Error ? error.message : "Unable to search category buyers.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void Promise.resolve().then(() => search(1, 20, emptyFilters));
    // LIVE loads the first page when the enquiry opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reset = () => {
    setFilters(emptyFilters);
    setPage(1);
    setSize(20);
    setAdvanced(false);
    setNotice("");
    void search(1, 20, emptyFilters);
  };
  const edit = (row?: Buyer) => {
    setNotice("");
    setForm(row ? { ...blank(), ...row, udf: row.udf || ["", "", "", "", ""], categories: row.categories || [] } : blank());
    setEditorTab("edit");
    setOpen(true);
  };
  const save = async () => {
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email))
      return setNotice("Invalid Emai");
    if (!form.buyer_name.trim()) return setNotice("Buyer Name is Mandatory");
    if (!form.email.trim() || !form.phone.trim())
      return setNotice("Please fill all the mandatory fields");
    setSaving(true);
    setNotice("");
    try {
      const saved = await apiSend<Buyer>(
        "/api/catBuyerSaveBS",
        "POST",
        form,
      );
      setForm(saved);
      setOpen(false);
      await search(1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save category buyer.");
    } finally {
      setSaving(false);
    }
  };
  const columns = [
    "Buyer Code",
    "Buyer Name*",
    "Buyer Description",
    "Phone",
    "Email",
    "Status",
    "Location",
    "Created by",
    "Actions",
  ];
  return (
    <Shell
      active="procurement"
      breadcrumb="Procurement > Category Buyers"
      openScreens={[{ label: "Category Buyers", to: "#" }]}
    >
      <div className="mb-2 flex justify-end gap-2">
        <button
          id="SearchBtn"
          onClick={() => void search(1)}
          className="rounded bg-amber-500 px-4 py-2 text-sm text-white"
        >
          Search
        </button>
        <button onClick={reset} className="rounded border px-4 py-2 text-sm">
          Reset
        </button>
        <button
          onClick={() => setAdvanced((value) => !value)}
          className="rounded border px-4 py-2 text-sm"
        >
          Advanced Search
        </button>
        <button
          onClick={() => edit()}
          className="rounded bg-[#2f9e9e] px-4 py-2 text-sm text-white"
        >
          <Plus size={14} className="mr-1 inline" />
          Add New
        </button>
      </div>
      {notice && (
        <p
          role="alert"
          className="mb-2 rounded border bg-red-50 p-2 text-sm text-red-700"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-2 border bg-white p-3 md:grid-cols-4">
        <label className="text-xs">
          Buyer Name
          <input
            id="gs_buyerName"
            className="ci mt-1 w-full"
            value={filters.buyerName}
            onChange={(e) => set("buyerName", e.target.value)}
          />
        </label>
        <label className="text-xs">
          Buyer Description
          <input
            id="gs_buyerDesc"
            className="ci mt-1 w-full"
            value={filters.buyerDesc}
            onChange={(e) => set("buyerDesc", e.target.value)}
          />
        </label>
        <label className="text-xs">
          Phone
          <input
            id="gs_phone"
            className="ci mt-1 w-full"
            value={filters.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </label>
        <label className="text-xs">
          Alternate Phone
          <input
            id="gs_altPhone"
            className="ci mt-1 w-full"
            value={filters.altPhone}
            onChange={(e) => set("altPhone", e.target.value)}
          />
        </label>
        <label className="text-xs">
          Email
          <input
            id="gs_email"
            className="ci mt-1 w-full"
            value={filters.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </label>
        <label className="text-xs">
          Status
          <select
            id="gs_displayIsActive"
            className="ci mt-1 w-full"
            value={filters.displayIsActive}
            onChange={(e) => set("displayIsActive", e.target.value)}
          >
            <option value="-1">--- Select ---</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </label>
        {advanced && (
          <>
            <label className="text-xs">
              Alternate Phone
              <input
                id="altPhone1"
                className="ci mt-1 w-full"
                value={filters.altPhone}
                onChange={(e) => set("altPhone", e.target.value)}
              />
            </label>
            <label className="text-xs">
              Category
              <select
                id="categorySelect2"
                multiple
                className="ci mt-1 h-28 w-full"
                value={filters.linkToCategory}
                onChange={(e) => set("linkToCategory", Array.from(e.target.selectedOptions, (option) => option.value))}
              >
                {categories.map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="mt-2 overflow-auto border bg-white">
        <table className="w-full text-xs">
          <thead className="bg-[#2f3b57] text-white">
            <tr>
              {columns.map((heading) => (
                <th key={heading} className="p-2 text-left">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center">
                  Loading…
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.buyer_code} className="border-t">
                  <td className="p-2">
                    <button
                      onClick={() => edit(row)}
                      className="text-sky-600"
                    >
                      {row.buyer_code}
                    </button>
                  </td>
                  <td>{row.buyer_name}</td>
                  <td>{row.description}</td>
                  <td>{row.phone}</td>
                  <td>{row.email}</td>
                  <td>{row.displayIsActive}</td>
                  <td>{row.location}</td>
                  <td>{row.created_by}</td>
                  <td>
                    <button
                      aria-label={`Edit ${row.buyer_code}`}
                      onClick={() => edit(row)}
                    >
                      ✎
                    </button>
                    <button
                      className="ml-2"
                      aria-label={`Audit ${row.buyer_code}`}
                      onClick={() => setAudit(row)}
                    >
                      ◷
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  {searched
                    ? "No records to view"
                    : "Search to view Category Buyers"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end gap-3 border bg-white p-2 text-xs">
        <span>
          Page {records ? page : 0} of {total}
        </span>
        <select
          aria-label="Records per Page"
          value={size}
          onChange={(e) => {
            const n = Number(e.target.value);
            setSize(n);
            if (searched) void search(1, n);
          }}
        >
          {SIZES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => void search(page - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label="Next page"
          disabled={!total || page >= total}
          onClick={() => void search(page + 1)}
        >
          <ChevronRight size={15} />
        </button>
        {records > 0 && (
          <span>
            View {(page - 1) * size + 1} - {Math.min(page * size, records)} of{" "}
            {records}
          </span>
        )}
      </div>
      <Modal
        title="Category Buyer Create/Edit"
        open={open}
        onClose={() => setOpen(false)}
        wide
      >
        <div className="mb-4 flex border-b">
          <button className={`px-4 py-2 text-sm ${editorTab === "edit" ? "border-b-2 border-rose-500" : ""}`} onClick={() => setEditorTab("edit")}>Create/Edit</button>
          <button className={`px-4 py-2 text-sm ${editorTab === "udf" ? "border-b-2 border-rose-500" : ""}`} onClick={() => setEditorTab("udf")}>User Defined Fields</button>
        </div>
        {editorTab === "edit" ? <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">
            Buyer Code
            <input
              id="buyerCode"
              className="ci mt-1 w-full"
              value={form.buyer_code}
              onChange={(e) => setForm({ ...form, buyer_code: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Buyer Name*
            <input
              id="buyerName"
              className="ci mt-1 w-full"
              value={form.buyer_name}
              onChange={(e) => setForm({ ...form, buyer_name: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Buyer Description
            <input
              id="buyerDesc"
              className="ci mt-1 w-full"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label className="text-xs">
            Email*
            <input
              id="email"
              className="ci mt-1 w-full"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Phone*
            <input
              id="phone"
              className="ci mt-1 w-full"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Alternate Phone
            <input
              id="altPhone"
              className="ci mt-1 w-full"
              value={form.alternate_phone}
              onChange={(e) =>
                setForm({ ...form, alternate_phone: e.target.value })
              }
            />
          </label>
          <label className="text-xs">
            Location
            <select id="buyerLocation" className="ci mt-1 w-full" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="">No location selected</option>
              {locations.map((location) => <option key={location.code} value={location.code}>{location.code} - {location.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              id="isActive"
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Is Active
          </label>
          <label className="text-xs">
            Category
            <select
              id="categorySelect"
              multiple
              className="ci mt-1 h-28 w-full"
              value={form.categories}
              onChange={(e) =>
                setForm({
                  ...form,
                  categories: Array.from(
                    e.target.selectedOptions,
                    (option) => option.value,
                  ),
                })
              }
            >
              {categories.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
          </label>
        </div> : <div className="grid gap-3 md:grid-cols-2">
          {form.udf.map((value, index) => (
            <label key={index} className="text-xs">
              UDF {index + 1} :
              <input
                id={`UDF${index + 1}`}
                className="ci mt-1 w-full"
                value={value}
                onChange={(e) => {
                  const udf = [...form.udf];
                  udf[index] = e.target.value;
                  setForm({ ...form, udf });
                }}
              />
            </label>
          ))}
        </div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            id="saveButton"
            disabled={saving}
            onClick={() => void save()}
            className="rounded bg-amber-500 px-4 py-2 text-sm text-white"
          >
            Save
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded border px-4 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </Modal>
      <Modal title="Audit Details" open={Boolean(audit)} onClose={() => setAudit(null)}>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt>Created By</dt><dd>{audit?.created_by}</dd>
          <dt>Created Date</dt><dd>{audit?.created_date}</dd>
          <dt>Updated By</dt><dd>{audit?.updated_by}</dd>
          <dt>Updated Date</dt><dd>{audit?.updated_date}</dd>
        </dl>
        <div className="mt-4 text-right"><button className="rounded border px-4 py-2" onClick={() => setAudit(null)}>Close</button></div>
      </Modal>
    </Shell>
  );
}
