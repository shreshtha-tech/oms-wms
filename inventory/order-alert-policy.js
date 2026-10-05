import { connectionCatalog } from './connection-catalog.js';
import { salesPrograms } from './sales-programs.js';
const custodyProgrammes=new Set(['myntra_mnow','amazon_now','amazon_fresh','flipkart_minutes','bbnow']);

// Intake contract/policy belongs here; recipient/team routing consumes neutral flags.
export async function orderAlertPolicy(db,{tenantId,orderId}){
 const row=(await db.query(`SELECT o.platform,o.ordered_at,o.first_seen_at,o.work_status,a.settings,
  p.program_key,p.stock_mode,s.source_type,s.notify,s.packing_allowed,s.custody
  FROM ci_unified_order o JOIN ci_channel_account a ON a.tenant_id=o.tenant_id AND a.id=o.account_id
  LEFT JOIN (SELECT po.tenant_id,po.order_id,po.program_key,sp.stock_mode FROM ci_program_order po
   JOIN ci_sales_program sp ON sp.tenant_id=po.tenant_id AND sp.account_id=po.account_id AND sp.program_key=po.program_key) p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
  LEFT JOIN ci_order_alert_source s ON s.tenant_id=o.tenant_id AND s.order_id=o.id
  WHERE o.tenant_id=$1 AND o.id=$2`,[tenantId,orderId])).rows[0];
 if(!row)return {enabled:false,stockAllowed:false,packingAllowed:false,informationalOnly:true};
 const sourceType=row.source_type||'live',settings=row.settings||{};
 const custody=Boolean(row.custody||connectionCatalog.find(c=>c.key===row.platform)?.custody||custodyProgrammes.has(row.program_key)||row.stock_mode==='custody');
 const accounting=row.platform==='tally';
 const programmeSettings=settings.programmeOrderAlerts?.[row.program_key]||{};
 const informationalOptIn=programmeSettings.informational===true||(!row.program_key&&settings.informationalOrderAlertsEnabled===true);
 const reportOptIn=programmeSettings.report===true||(!row.program_key&&settings.orderReportAlertsEnabled===true);
 const creation=row.ordered_at&&new Date(row.ordered_at).getTime(),fresh=(!row.ordered_at&&sourceType!=='report')||creation>=Date.now()-2*60*60*1000;
 const firstSeen=new Date(row.first_seen_at).getTime();
 const enabled=!accounting&&row.notify!==false&&fresh&&firstSeen>=Date.now()-2*60*60*1000&&!['cancelled','returned'].includes(row.work_status)
  &&(sourceType!=='report'||reportOptIn)&&(!custody||informationalOptIn);
 return {enabled,sourceType,programme:row.program_key||null,informationalOnly:custody,packingAllowed:!accounting&&!custody&&row.packing_allowed!==false,stockAllowed:!accounting&&!custody};
}

export async function assignIncomingProgramme(db,{tenantId,accountId,orderId,platform,programme,observedAt}){
 if(!programme)return;
 const config=salesPrograms.find(p=>p.key===programme);
 if(!config?.parents.includes(platform))throw Object.assign(new Error('Programme is incompatible with this parent account'),{status:400});
 const setup=await db.query('SELECT 1 FROM ci_sales_program WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3',[tenantId,accountId,programme]);
 if(!setup.rowCount)throw Object.assign(new Error('Save programme enrollment before tagging incoming orders'),{status:409});
 const prior=(await db.query('SELECT program_key FROM ci_program_order WHERE tenant_id=$1 AND order_id=$2',[tenantId,orderId])).rows[0];
 if(prior&&prior.program_key!==programme)throw Object.assign(new Error('Incoming programme conflicts with existing order assignment'),{status:409});
 await db.query(`INSERT INTO ci_program_order(tenant_id,account_id,program_key,order_id,reference,observed_at)
  VALUES($1,$2,$3,$4,'authorized_order_adapter',$5) ON CONFLICT(tenant_id,order_id) DO NOTHING`,[tenantId,accountId,programme,orderId,observedAt||new Date()]);
}
