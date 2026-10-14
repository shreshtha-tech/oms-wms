const cellText = value => String(value ?? '');
export const csvExportLimit = () => Object.assign(new Error('Export exceeds the supported CSV size. Narrow the date range or filters.'),{code:'CSV_EXPORT_LIMIT',status:413});
export function safeCsvCell(value) {
 const text=cellText(value);
 // Spreadsheet applications may evaluate these prefixes even after CSV quoting.
 const guarded=/^\s*[=+\-@]/u.test(text)?`'${text}`:text;
 return `"${guarded.replaceAll('"','""')}"`;
}
export function safeCsv(rows, keys) {
 if(!Array.isArray(rows)||!Array.isArray(keys)||rows.length>1000||keys.length>64)throw csvExportLimit();
 const lines=[];let bytes=0;
 for(let index=-1;index<rows.length;index++){
  const row=index<0?keys:keys.map(key=>rows[index][key]);
  const line=row.map(safeCsvCell).join(',');
  bytes+=Buffer.byteLength(line,'utf8')+(lines.length?2:0);
  if(bytes>1024*1024)throw csvExportLimit();
  lines.push(line);
 }
 return lines.join('\r\n');
}
