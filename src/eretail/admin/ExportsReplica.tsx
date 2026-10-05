import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { apiGet, apiSend } from '../../lib/api';
import { AdminParityHeader, AdminParityNotice } from './AdminParityParts';

type Report = { id: number; reportID: string; status: string; date: string; reportName: string; createDateText: string; link: boolean; errorMsg: string; uuId: string; forceProcess: string };
const columns = ['Report ID', 'Status', 'Report Request Date', 'Report Names', 'Report Complete Date', 'Download', 'Error Msg'];
const widths = [62, 133, 124, 178, 133, 115, 391];

export default function ExportsReplica() {
  const [rows, setRows] = useState<Report[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = async () => {
    setBusy(true);
    try { const result = await apiGet<{ rowDTOListFromUpdate: Report[] }>('/api/exports'); setRows(result.rowDTOListFromUpdate || []); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to load reports'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);
  const refresh = () => {
    setCooldown(true);
    timer.current = setTimeout(() => setCooldown(false), 2000);
    void load();
  };
  const download = async (report: Report) => {
    try {
      const result = await apiSend<{content: string; fileName: string}>('/api/exports', 'POST', {action:'download', reportID:report.reportID, uuId:report.uuId});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([result.content], {type:'text/csv'}));
      link.download = result.fileName; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to download report'); }
  };
  const force = async (report: Report) => {
    try { await apiSend('/api/exports', 'POST', {action:'force', uuId:report.uuId}); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to process report'); }
  };
  return <div className="admin-parity admin-exports">
    <AdminParityHeader home="Home" title="Pending Report"><div className="admin-export-notes"><div>* Only last 20 reports generated can be downloaded.<br />* Force Pull option will be enabled after 300 seconds.</div><button title="Refresh" aria-label="Refresh" className="admin-export-refresh" style={{visibility:cooldown?'hidden':'visible'}} disabled={busy} onClick={refresh}><RefreshCw size={19} /></button></div></AdminParityHeader>
    <AdminParityNotice message={notice} close={() => setNotice('')} />
    <div className="admin-export-grid" aria-busy={busy}><table><colgroup>{widths.map((width,index)=><col key={index} style={{width:`${width / 1136 * 100}%`}} />)}</colgroup><thead><tr>{columns.map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(report=><tr key={report.id}>
      <td>{report.reportID}</td><td>{report.status}</td><td>{report.date}</td><td>{report.reportName}</td><td>{report.createDateText}</td>
      <td>{/success/i.test(report.status) && report.link ? <button aria-label={`Download ${report.reportID}`} onClick={()=>void download(report)}><Download size={14} /></button> : report.forceProcess==='Y' ? <button className="text-blue-700 underline" onClick={()=>void force(report)}>Force Pull</button> : null}</td><td>{report.errorMsg}</td>
    </tr>)}</tbody></table></div>
  </div>;
}
