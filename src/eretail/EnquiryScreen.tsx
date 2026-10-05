import { useRequestFailure } from '../lib/requestFailures';
import RequestErrorState from '../components/RequestErrorState';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useGlobalBlocking } from './ScreenContext';
import {
  Search, HelpCircle, Home, ChevronRight, X,
  ChevronsLeft, ChevronLeft, ChevronsRight, Pencil, Info, Trash2, ArrowUpDown,
} from 'lucide-react';

export type ECol = {
  key: string;
  label: string;
  filter?: 'text' | 'select' | 'none';
  options?: string[];
  width?: string;
  render?: (r: any) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  filterAction?: (value: string, setValue: (value: string) => void) => void;
  filterKey?: string;
};

export type EAction = { label: string; icon?: any; onClick: (filteredRows?: any[]) => void; variant?: 'green' | 'ghost' };
export type EField = { key: string; label: string; type?: 'text' | 'select' | 'checkbox'; options?: string[]; disabled?: boolean; value?: string; checked?: boolean; onChange?: (value: string | boolean) => void; filterAction?: () => void };

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded px-3 py-1 text-xs font-semibold text-white ${active ? 'bg-[#3aa856]' : 'bg-[#b0b7c0]'}`}>
      {active ? 'Active' : 'Inactive'}<span className="h-2.5 w-2.5 rounded-full bg-white/90" />
    </span>
  );
}

export default function EnquiryScreen({
  breadcrumb, cols, rows, loading, actions = [], fields = [], onRowEdit, onRowInfo, onRowDelete, selectedIds = [], onSelectionChange,
  error, onRetry, emptyText = 'No records to view', onSearch, onReset, remote, pageSizes = [20, 50, 100, 200], sectionTitle, actionsBeforeResetCount = 0, hideActionBar = false, initialFilters = {},
  textFilterBehavior = 'enter', selectFilterBehavior = 'manual', filterDelay = 500,
}: {
  breadcrumb: { label: string }[];
  cols: ECol[];
  rows: any[];
  loading?: boolean;
  actions?: EAction[];
  fields?: EField[];
  onRowEdit?: (r: any) => void;
  onRowInfo?: (r: any) => void;
  onRowDelete?: (r: any) => void;
  selectedIds?: number[];
  onSelectionChange?: (ids: number[]) => void;
  error?: Error & { status?: number };
  onRetry?: () => void;
  emptyText?: string;
  onSearch?: (filters: Record<string, string>, page: number, pageSize: number) => void;
  onReset?: () => void;
  remote?: { page: number; total: number; records: number; pageSize: number };
  pageSizes?: number[];
  sectionTitle?: string;
  actionsBeforeResetCount?: number;
  hideActionBar?: boolean;
  initialFilters?: Record<string, string>;
  textFilterBehavior?: 'enter' | 'debounced' | 'manual';
  selectFilterBehavior?: 'change' | 'manual';
  filterDelay?: number;
}) {
  const requestFailure = useRequestFailure();
  error = error || requestFailure?.error;
  onRetry = onRetry || (requestFailure ? () => { void requestFailure.retry().catch(() => {}); onSearch?.(filters, currentPage, currentPageSize); } : undefined);
  useGlobalBlocking(!!loading);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (filterTimer.current) clearTimeout(filterTimer.current); }, []);

  const setF = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const runSearch = (next: Record<string, string>) => { setApplied(next); setPage(1); onSearch?.(next, 1, remote?.pageSize || pageSize); };
  const doSearch = () => runSearch(filters);
  const changeFilter = (key: string, value: string, behavior: 'text' | 'select') => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (behavior === 'select' && selectFilterBehavior === 'change') runSearch(next);
    if (behavior === 'text' && textFilterBehavior === 'debounced') {
      if (filterTimer.current) clearTimeout(filterTimer.current);
      filterTimer.current = setTimeout(() => runSearch(next), filterDelay);
    }
  };
  const doReset = () => { setFilters(initialFilters); setApplied({}); setPage(1); onReset?.(); };

  const filtered = useMemo(() => {
    let out = remote ? rows : rows.filter((r) => Object.entries(applied).every(([k, v]) => {
      if (!v) return true;
      return String(r[k] ?? '').toLowerCase().includes(v.toLowerCase());
    }));
    if (sortKey) out = [...out].sort((a, b) => (a[sortKey] === b[sortKey] ? 0 : (a[sortKey] > b[sortKey] ? 1 : -1) * (sortAsc ? 1 : -1)));
    return out;
  }, [rows, applied, sortKey, sortAsc, remote]);

  const totalPages = remote ? remote.total : Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = remote ? remote.page : page;
  const currentPageSize = remote ? remote.pageSize : pageSize;
  const totalRecords = remote ? remote.records : filtered.length;
  const pageRows = error ? [] : remote ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);
  const goPage = (value: number, size = currentPageSize) => { setPage(value); if (remote) onSearch?.(filters, value, size); };
  const hasActions = !!(onRowEdit || onRowInfo || onRowDelete);
  useEffect(() => { const retry = () => onSearch?.(filters, currentPage, currentPageSize); window.addEventListener('api-recovered', retry); return () => window.removeEventListener('api-recovered', retry); }, [onSearch, filters, currentPage, currentPageSize]);
  const selectable = !!onSelectionChange;

  const btn = 'flex items-center gap-1.5 rounded px-3.5 py-2 text-sm font-medium transition';

  return (
    <div>
      {/* Breadcrumb + action bar */}
      {!hideActionBar && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <Home size={14} />
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={13} className="text-slate-300" />}
              <span className={i === breadcrumb.length - 1 ? 'font-medium text-slate-700' : ''}>{b.label}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={doSearch} className={`${btn} bg-[#f5a623] text-white hover:brightness-105`}><Search size={14} /> Search</button>
          {actions.slice(0, actionsBeforeResetCount).map((a, i) => (
            <button key={`pre-${i}`} onClick={() => a.onClick(filtered)} className={`${btn} ${a.variant === 'green' ? 'bg-[#2ea44f] text-white hover:brightness-105' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {a.icon && <a.icon size={14} />}{a.label}
            </button>
          ))}
          <button onClick={doReset} className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><X size={14} /> Reset</button>
          {actions.slice(actionsBeforeResetCount).map((a, i) => (
            <button key={`post-${i}`} onClick={() => a.onClick(filtered)} className={`${btn} ${a.variant === 'green' ? 'bg-[#2ea44f] text-white hover:brightness-105' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {a.icon && <a.icon size={14} />}{a.label}
            </button>
          ))}
          <button className="rounded-full p-1 text-[#3b8fc4] hover:bg-slate-100" title="Help"><HelpCircle size={18} /></button>
        </div>
      </div>}

      {sectionTitle && <div className="mb-0 border border-b-0 bg-white px-4 pt-2"><span className="inline-block border-b-2 border-rose-500 px-2 pb-2 text-base font-semibold text-slate-700">{sectionTitle}</span></div>}

      {fields.length > 0 && <section className="mb-3 grid gap-3 border bg-white p-4 md:grid-cols-3">
        {fields.map((field) => <label key={field.key} className="text-xs text-slate-600">{field.label}
          {field.type === 'select' ? <select aria-label={field.label} className="inp mt-1" disabled={field.disabled} value={field.value ?? filters[field.key] ?? ''} onChange={(event) => field.onChange ? field.onChange(event.target.value) : setF(field.key, event.target.value)}>{(field.options || []).map((option, index) => <option key={`${option}-${index}`} value={option === '--- Select ---' ? '' : option}>{option}</option>)}</select> : field.type === 'checkbox' ? <input aria-label={field.label} className="ml-3 mt-2" type="checkbox" checked={field.checked} onChange={(event) => field.onChange?.(event.target.checked)} /> : <div className="mt-1 flex"><input aria-label={field.label} className="inp rounded-r-none" disabled={field.disabled} value={field.value ?? filters[field.key] ?? ''} onChange={(event) => field.onChange ? field.onChange(event.target.value) : setF(field.key, event.target.value)} />{field.filterAction && <button aria-label={`Open ${field.label} picker`} type="button" className="rounded-r border px-3 text-sky-700" onClick={field.filterAction}>...</button>}</div>}
        </label>)}
      </section>}

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {selectable && <th className="px-2 pt-3 pb-1"><input aria-label="Select all rows" type="checkbox" checked={pageRows.length > 0 && pageRows.every((row) => selectedIds.includes(Number(row.id)))} onChange={(event) => onSelectionChange?.(event.target.checked ? pageRows.map((row) => Number(row.id)) : [])} /></th>}
              {cols.map((c) => (
                <th key={c.key} className="px-3 pt-3 pb-1 text-center text-[13px] font-semibold text-slate-600" style={{ width: c.width }}>
                  <button className="inline-flex items-center gap-1" onClick={() => c.sortable && (sortKey === c.key ? setSortAsc(!sortAsc) : (setSortKey(c.key), setSortAsc(true)))}>
                    {c.label}{c.sortable && <ArrowUpDown size={12} className="text-slate-400" />}
                  </button>
                </th>
              ))}
              {hasActions && <th className="px-3 pt-3 pb-1 text-center text-[13px] font-semibold text-slate-600">Actions</th>}
            </tr>
            <tr className="border-b-2 border-slate-200 bg-slate-50">
              {selectable && <th className="px-2 pb-2" />}
              {cols.map((c) => (
                <th key={c.key} className="px-2 pb-2">
                  {c.filter === 'none' ? null : c.filter === 'select' ? (
                    <select value={filters[c.filterKey || c.key] || ''} onChange={(e) => changeFilter(c.filterKey || c.key, e.target.value, 'select')} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-[#2f9e9e]">
                      <option value="">--- Select ---</option>
                      {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center rounded border border-slate-300 bg-white px-2">
                      <input value={filters[c.filterKey || c.key] || ''} onChange={(e) => changeFilter(c.filterKey || c.key, e.target.value, 'text')} onKeyDown={(e) => { if (e.key !== 'Enter') return; if (textFilterBehavior === 'debounced') e.preventDefault(); else if (textFilterBehavior === 'enter') doSearch(); }} className="w-full py-1.5 text-xs outline-none" />
                      {c.filterAction ? <button aria-label={`Select ${c.label}`} type="button" onClick={() => c.filterAction?.(filters[c.filterKey || c.key] || '', (value) => setF(c.filterKey || c.key, value))} className="px-1 text-sky-700">...</button> : <Search size={12} className="text-slate-400" />}
                    </div>
                  )}
                </th>
              ))}
              {hasActions && <th className="px-2 pb-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={cols.length + (hasActions ? 1 : 0) + (selectable ? 1 : 0)} className="px-4 py-16 text-center text-slate-400"><div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#2f9e9e]" /><p className="mt-2 text-xs">Loading…</p></td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={cols.length + (hasActions ? 1 : 0) + (selectable ? 1 : 0)} className="px-4 py-16 text-center text-sm text-slate-400">{error ? <RequestErrorState error={error} onRetry={onRetry} /> : emptyText}</td></tr>
            ) : pageRows.map((r, i) => (
              <tr key={r.id ?? i} className={`${i % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-[#eef7fb]`}>
                {selectable && <td className="px-2 text-center"><input aria-label={`Select row ${r.id}`} type="checkbox" checked={selectedIds.includes(Number(r.id))} onChange={(event) => onSelectionChange?.(event.target.checked ? [...selectedIds, Number(r.id)] : selectedIds.filter((id) => id !== Number(r.id)))} /></td>}
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2.5 text-slate-700 ${c.align === 'left' ? 'text-left' : c.align === 'right' ? 'text-right' : 'text-center'}`}>
                    {c.render ? c.render(r) : (r[c.key] ?? '')}
                  </td>
                ))}
                {hasActions && (
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {onRowEdit && <button onClick={() => onRowEdit(r)} className="flex h-7 w-7 items-center justify-center rounded bg-[#f5a623] text-white hover:brightness-105" title="Edit"><Pencil size={13} /></button>}
                      {onRowInfo && <button onClick={() => onRowInfo(r)} className="flex h-7 w-7 items-center justify-center rounded bg-[#8B4513] text-white hover:brightness-105" title="Info"><Info size={13} /></button>}
                      {onRowDelete && <button onClick={() => onRowDelete(r)} className="flex h-7 w-7 items-center justify-center rounded bg-rose-600 text-white hover:brightness-105" title="Delete"><Trash2 size={13} /></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
          <div className="flex items-center gap-1">
            <Pg onClick={() => goPage(1)} disabled={currentPage === 1}><ChevronsLeft size={15} /></Pg>
            <Pg onClick={() => goPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}><ChevronLeft size={15} /></Pg>
            <span className="mx-2 flex items-center gap-1">Page <input value={totalRecords ? currentPage : 0} onChange={(e) => { const v = Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)); goPage(v); }} className="w-12 rounded border border-slate-300 px-2 py-1 text-center" /> of {totalRecords ? totalPages : 0}</span>
            <Pg onClick={() => goPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}><ChevronRight size={15} /></Pg>
            <Pg onClick={() => goPage(totalPages)} disabled={currentPage >= totalPages}><ChevronsRight size={15} /></Pg>
            <select aria-label="Records per Page" value={currentPageSize} onChange={(e) => { const size=Number(e.target.value); setPageSize(size); goPage(1,size); }} className="ml-2 rounded border border-slate-300 px-2 py-1">
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <span>{error ? 'Data unavailable' : totalRecords ? `View ${(currentPage - 1) * currentPageSize + 1} - ${Math.min(currentPage * currentPageSize, totalRecords)} of ${totalRecords}` : 'No records to view'}</span>
        </div>
      </div>
    </div>
  );
}

function Pg({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40">{children}</button>;
}
