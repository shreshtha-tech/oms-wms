const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

export function reportPrintHtml(input: {
  title: string; warehouse: string; from: string; to: string;
  data: { columns: string[]; rows: unknown[][] };
}) {
  const { title, warehouse, from, to, data } = input;
  const filters = `Warehouse: ${warehouse}${from ? ` · From ${from}` : ''}${to ? ` · To ${to}` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:Manrope,Arial,sans-serif;padding:24px;color:#1e293b}
    h1{font-size:18px;border-bottom:2px solid #2f9e9e;padding-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}
    th{background:#2f3b57;color:#fff;padding:8px;text-align:left}
    td{padding:6px 8px;border-bottom:1px solid #e2e8f0}</style></head><body>
    <h1>${escapeHtml(title)}</h1><p style="font-size:11px;color:#64748b">${escapeHtml(filters)}</p>
    <table><thead><tr>${data.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
    <tbody>${data.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </body></html>`;
}
