import { sendDatabaseUnavailable, cors, find, insert } from './mongo.js';

const normalize = row => ({
  id: row.id,
  reportID: row.code || row.reportID || `REPORT-${row.id}`,
  status: row.status || 'Pending',
  date: row.created_date || row.date || '',
  reportName: row.name || row.reportName || '',
  createDateText: row.completed_date || row.createDateText || '',
  link: !!row.content && (row.link ?? /success/i.test(row.status || '')),
  errorMsg: row.errorMsg || '',
  uuId: row.uuId || `EXPORT-${row.id}`,
  forceProcess: row.forceProcess ?? (/pending|failed|error/i.test(row.status || '') && Date.now() - new Date(row.created_date || 0).getTime() >= 300000 ? 'Y' : 'N'),
});

export default async function handler(req,res) {
  if (cors(req,res)) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.action === 'meta') return res.json({
        columns: ['Report ID','Status','Report Request Date','Report Names','Report Complete Date','Download','Error Msg'],
        rowNum: 30, lastDownloadable: 20, forcePullSeconds: 300,
        endpoints: {search:'fetchPendingReports',download:'downloadReportTemplate',force:'jsonForceProcessExport'},
      });
      const rows = (await find('generic_records',{module:'pending-report'},{sort:{id:-1}})).map(normalize).slice(0,30);
      const size=30,page=Math.max(1,Number(req.query?.page)||1);
      return res.json({rowDTOListFromUpdate:rows.slice((page-1)*size,page*size),page,total:Math.ceil(rows.length/size),records:rows.length,rows:size});
    }
    if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
    const body=req.body||{};
    if (body.action === 'seed') {
      const row=await insert('generic_records',{module:'pending-report',code:body.reportID||`EXP-${Date.now()}`,name:body.reportName||'Verification Export',status:body.status||'Pending',created_date:body.date||new Date().toISOString(),completed_date:body.createDateText||'',content:body.content||'',link:!!body.link,errorMsg:body.errorMsg||'',forceProcess:body.forceProcess});
      return res.status(201).json(normalize(row));
    }
    const rows=await find('generic_records',{module:'pending-report'});
    const row=rows.find(item=>(item.uuId||`EXPORT-${item.id}`)===body.uuId && (body.action!=='download'||(item.code||item.reportID)===body.reportID));
    if (!row) return res.status(404).json({error:'Report not found'});
    const report=normalize(row);
    if (body.action==='force') {
      if (report.forceProcess!=='Y') return res.status(400).json({error:'Force Pull option will be enabled after 300 seconds.'});
      return res.status(501).json({error:'Force Pull requires the report generation service.'});
    }
    if (body.action==='download') {
      if (!/success/i.test(report.status)||!report.link) return res.status(400).json({error:'Report is not available for download'});
      return res.json({fileName:`${report.reportID}.csv`,content:row.content});
    }
    return res.status(400).json({error:'Unsupported Exports action'});
  } catch(error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('exports error:',{ name: error?.name, code: error?.code }); return res.status(500).json({error:error.message}); }
}
