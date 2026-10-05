import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiSend } from '../../lib/api';
import { AdminParityHeader, AdminParityNotice } from './AdminParityParts';
import { AdminAction } from './AdminLogGrid';

export default function UserAuditLogReplica() {
  const [logType,setLogType]=useState('-1'),[fromDate,setFrom]=useState(''),[toDate,setTo]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const nav=useNavigate();
  const download=async()=>{
    if(!fromDate||!toDate||logType==='-1'){setMessage('Please fill all mandatory fields');document.getElementById(!fromDate?'audit-from':!toDate?'audit-to':'audit-log')?.focus();return;}
    setBusy(true);try{await apiSend('/api/admin-parity','POST',{action:'audit-export',logType,fromDate,toDate});nav('/app/admin/exports');}catch(e){setMessage(e instanceof Error?e.message:'Unable to generate report');}finally{setBusy(false);}
  };
  return <div className="admin-parity"><AdminParityHeader title="User Audit Logs"><AdminAction label="Download" disabled={busy} onClick={()=>void download()}/><AdminAction label="Reset" onClick={()=>{setLogType('-1');setFrom('');setTo('');setMessage('');}}/></AdminParityHeader><AdminParityNotice message={message} close={()=>setMessage('')}/><div className="admin-form-panel">
    <label className="admin-form-field"><span>Audit</span><select aria-label="Audit"><option>User Access Logs</option></select></label>
    <label className="admin-form-field"><span>Logs</span><select id="audit-log" aria-label="Logs" value={logType} onChange={e=>setLogType(e.target.value)}><option value="-1">--- Select ---</option><option value="Login">Login Logs</option><option value="Role">Role Logs</option><option value="UserLogs">User Edit Logs</option><option value="User">User Logs</option></select></label>
    <label className="admin-form-field"><span>From Date</span><input id="audit-from" aria-label="From Date" value={fromDate} onChange={e=>setFrom(e.target.value)}/></label><label className="admin-form-field"><span>To Date</span><input id="audit-to" aria-label="To Date" value={toDate} onChange={e=>setTo(e.target.value)}/></label>
  </div></div>;
}
