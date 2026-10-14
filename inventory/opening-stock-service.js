import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { inventoryPool, transaction } from './db.js';
import { InventoryConflict, applyInventoryEventInTransaction } from './ledger.js';
import { validateOpeningStockWorkbook } from './opening-stock-validation.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' ? value.trim() : '';
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function actorName(actor) {
  if (!/^[A-Za-z0-9@._-]{1,120}$/.test(actor ?? '')) throw new TypeError('Authenticated actor identity is required');
  return actor;
}
function identity(input) {
  if (!text(input.tenantId) || !text(input.batchId)) throw new TypeError('Tenant and batch identity are required');
}
const audit = (db, tenantId, batchId, from, to, actor, reason = null) => db.query(
  'INSERT INTO ci_opening_stock_audit(tenant_id,batch_id,from_status,to_status,actor,reason) VALUES($1,$2,$3,$4,$5,$6)',
  [tenantId,batchId,from,to,actor,reason],
);

/** Stages a tenant-scoped draft; the HTTP route requires explicit staging permission. */
export async function stageOpeningStockDraft({ tenantId, sourceReference, sourceDate, fileName, bytes, mapping, actor }) {
  actorName(actor);
  const reference = text(sourceReference);
  if (!text(tenantId) || !reference || reference.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate ?? '') || !text(fileName) || !Buffer.isBuffer(bytes)) throw new TypeError('Source identity, date, file and tenant are required');
  const db = inventoryPool();
  const [skuRows, locationRows] = await Promise.all([
    db.query('SELECT id,tenant_id,sku,uom,opening_stock_active AS active FROM ci_master_sku WHERE tenant_id=$1',[tenantId]),
    db.query('SELECT id,tenant_id,code,location_type AS type,opening_stock_active AS active FROM ci_location WHERE tenant_id=$1',[tenantId]),
  ]);
  const report = await validateOpeningStockWorkbook({ bytes, tenantId, mapping,
    skus: skuRows.rows.map(row => ({ ...row, tenantId: row.tenant_id })),
    locations: locationRows.rows.map(row => ({ ...row, tenantId: row.tenant_id })),
  });
  if (!report.rowsReadyForApproval) throw Object.assign(new InventoryConflict('Opening-stock dry run has rejected or ambiguous rows'),{summary:{rowsRead:report.rowsRead,rowsInvalid:report.rowsInvalid,counts:report.counts}});
  const lines = report.rows.map(row => ({ sheet: row.sheet, row: row.row, skuId: row.skuId, locationId: row.locationId, quantity: row.quantity, uom: mapping.uom }));
  const mappingSha = sha(stable(mapping)), rowDigest = sha(stable(lines));
  const summary = { rowsRead: report.rowsRead, rowsValid: report.rowsValid, rowsInvalid: 0, mappingVersion: mapping.version, uom: mapping.uom };
  return transaction(async tx => {
    const locks = [`opening-source:${tenantId}:${reference}`,`opening-content:${tenantId}:${report.fileSha256}:${mapping.version}:${sourceDate}`].sort();
    for (const lock of locks) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lock]);
    const previous = (await tx.query(`SELECT *,source_date::text AS source_date_text FROM ci_opening_stock_batch WHERE tenant_id=$1 AND
      (source_reference=$2 OR (file_sha256=$3 AND mapping_version=$4 AND source_date=$5)) FOR UPDATE`,
    [tenantId,reference,report.fileSha256,mapping.version,sourceDate])).rows;
    if (previous.length) {
      if (previous.length !== 1 || previous[0].file_sha256 !== report.fileSha256 || previous[0].mapping_sha256 !== mappingSha || previous[0].row_digest !== rowDigest || previous[0].source_date_text !== sourceDate) throw new InventoryConflict('Opening-stock source identity was reused with different content or mapping');
      return { id: previous[0].id, status: previous[0].status, duplicate: true, summary: previous[0].validation_summary };
    }
    const batch = (await tx.query(`INSERT INTO ci_opening_stock_batch
      (tenant_id,source_reference,file_sha256,file_name,file_bytes,source_date,mapping_version,mapping_sha256,row_digest,rows_read,rows_valid,validation_summary,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,status`,
    [tenantId,reference,report.fileSha256,basename(fileName).slice(0,200),bytes.length,sourceDate,mapping.version,mappingSha,rowDigest,report.rowsRead,report.rowsValid,summary,actor])).rows[0];
    await audit(tx,tenantId,batch.id,null,'DRAFT',actor);
    await tx.query(`INSERT INTO ci_opening_stock_line(tenant_id,batch_id,sheet_name,source_row,master_sku_id,location_id,quantity,uom)
      SELECT $1,$2,x.sheet,x.row,x."skuId"::uuid,x."locationId"::uuid,x.quantity::bigint,x.uom
      FROM jsonb_to_recordset($3::jsonb) AS x(sheet text,row integer,"skuId" text,"locationId" text,quantity bigint,uom text)`,
    [tenantId,batch.id,JSON.stringify(lines)]);
    await tx.query("UPDATE ci_opening_stock_batch SET status='VALIDATED',validated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,batch.id]);
    await audit(tx,tenantId,batch.id,'DRAFT','VALIDATED',actor);
    return { id: batch.id, status: 'VALIDATED', duplicate: false, summary };
  });
}

async function transition(tenantId,batchId,actor,expected,next,columns='') {
  actorName(actor);identity({tenantId,batchId});
  return transaction(async db => {
    const batch=(await db.query('SELECT * FROM ci_opening_stock_batch WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,batchId])).rows[0];
    if (!batch) throw new InventoryConflict('Opening-stock batch not found');
    if (batch.status === next) return { id:batch.id,status:next,duplicate:true };
    if (batch.status !== expected) throw new InventoryConflict(`Opening-stock batch is ${batch.status}, expected ${expected}`);
    if (next === 'APPROVED' && batch.created_by === actor) throw new InventoryConflict('Creator cannot approve opening stock');
    await db.query(`UPDATE ci_opening_stock_batch SET status=$3 ${columns} WHERE tenant_id=$1 AND id=$2`,columns.includes('$4')?[tenantId,batchId,next,actor]:[tenantId,batchId,next]);
    await audit(db,tenantId,batchId,expected,next,actor);
    return { id:batch.id,status:next,duplicate:false };
  });
}

export const requestOpeningStockApproval = ({tenantId,batchId,actor}) => transition(tenantId,batchId,actor,'VALIDATED','AWAITING_APPROVAL',',approval_requested_at=now()');
export const approveOpeningStock = ({tenantId,batchId,actor}) => transition(tenantId,batchId,actor,'AWAITING_APPROVAL','APPROVED',',approved_by=$4,approved_at=now()');

export async function readOpeningStockBatch({tenantId,batchId}) {
  identity({tenantId,batchId});
  const db=inventoryPool();
  const batch=(await db.query(`SELECT id,status,source_reference,file_sha256,file_name,file_bytes,source_date::text AS source_date,
      mapping_version,rows_read,rows_valid,validation_summary,created_by,created_at,validated_at,approval_requested_at,
      approved_by,approved_at,posted_by,posting_started_at,posted_at,reconciled_at,result
    FROM ci_opening_stock_batch WHERE tenant_id=$1 AND id=$2`,[tenantId,batchId])).rows[0];
  if(!batch)return null;
  const [lines,auditRows]=await Promise.all([
    db.query(`SELECT l.sheet_name,l.source_row,s.sku,lx.code AS location,l.quantity,l.uom,l.event_id
      FROM ci_opening_stock_line l JOIN ci_master_sku s ON s.tenant_id=l.tenant_id AND s.id=l.master_sku_id
      JOIN ci_location lx ON lx.tenant_id=l.tenant_id AND lx.id=l.location_id
      WHERE l.tenant_id=$1 AND l.batch_id=$2 ORDER BY l.sheet_name,l.source_row`,[tenantId,batchId]),
    db.query('SELECT from_status,to_status,actor,reason,created_at FROM ci_opening_stock_audit WHERE tenant_id=$1 AND batch_id=$2 ORDER BY id',[tenantId,batchId]),
  ]);
  return {batch,lines:lines.rows,audit:auditRows.rows};
}

/** Posting command; the HTTP route additionally requires explicit permission and this service enforces dual control. */
export async function postApprovedOpeningStock({tenantId,batchId,actor}) {
  actorName(actor);identity({tenantId,batchId});
  return transaction(async db => {
    const batch=(await db.query('SELECT * FROM ci_opening_stock_batch WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,batchId])).rows[0];
    if (!batch) throw new InventoryConflict('Opening-stock batch not found');
    if (batch.status === 'RECONCILED') return { ...batch.result,duplicate:true };
    if (batch.status !== 'APPROVED' || !batch.approved_by || batch.approved_by === actor || batch.created_by === actor) throw new InventoryConflict('Opening-stock batch needs separate creator, approver and poster');
    const lines=(await db.query(`SELECT l.*,s.uom AS sku_uom,s.opening_stock_active AS sku_active,lx.location_type,lx.opening_stock_active AS location_active
      FROM ci_opening_stock_line l JOIN ci_master_sku s ON s.tenant_id=l.tenant_id AND s.id=l.master_sku_id
      JOIN ci_location lx ON lx.tenant_id=l.tenant_id AND lx.id=l.location_id
      WHERE l.tenant_id=$1 AND l.batch_id=$2 ORDER BY l.master_sku_id,l.location_id FOR UPDATE OF s,lx,l`,[tenantId,batchId])).rows;
    if (!lines.length || lines.length !== batch.rows_valid || batch.rows_valid !== batch.rows_read) throw new InventoryConflict('Opening-stock line set differs from approved validation');
    const sourceOrder=[...lines].sort((left,right) => left.sheet_name.localeCompare(right.sheet_name) || left.source_row-right.source_row);
    const digest=sha(stable(sourceOrder.map(line => ({sheet:line.sheet_name,row:line.source_row,skuId:line.master_sku_id,locationId:line.location_id,quantity:Number(line.quantity),uom:line.uom}))));
    if (digest !== batch.row_digest) throw new InventoryConflict('Opening-stock lines changed after validation');
    for (const line of lines) {
      if (line.sku_active !== true || line.location_active !== true || line.uom !== line.sku_uom || line.uom !== batch.validation_summary?.uom || !['warehouse','store'].includes(line.location_type)) throw new InventoryConflict('SKU, location or UOM eligibility changed after approval');
      const prior=(await db.query(`SELECT 1 FROM ci_inventory_event WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 LIMIT 1`,[tenantId,line.master_sku_id,line.location_id])).rowCount;
      const balance=(await db.query(`SELECT 1 FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 LIMIT 1`,[tenantId,line.master_sku_id,line.location_id])).rowCount;
      if (prior || balance) throw new InventoryConflict('Opening stock requires an unused SKU/location balance; reconcile existing activity');
    }
    await db.query("UPDATE ci_opening_stock_batch SET status='POSTING',posting_started_at=now(),posted_by=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,batchId,actor]);
    await audit(db,tenantId,batchId,'APPROVED','POSTING',actor);
    const events=[];
    for (const line of lines) {
      const event=await applyInventoryEventInTransaction(db,{
        tenantId,masterSkuId:line.master_sku_id,locationId:line.location_id,
        eventKey:`opening:${batchId}:${line.sheet_name}:${line.source_row}`,eventType:'opening_stock',source:'controlled_opening_import',
        externalReference:JSON.stringify({batchId,fileSha256:batch.file_sha256,mappingVersion:batch.mapping_version,sheet:line.sheet_name,row:line.source_row,actor}),
        delta_on_hand:Number(line.quantity),
      });
      if (event.duplicate) throw new InventoryConflict('Opening-stock event already exists while batch is unposted');
      await db.query('UPDATE ci_opening_stock_line SET event_id=$4 WHERE tenant_id=$1 AND batch_id=$2 AND source_row=$3 AND sheet_name=$5',[tenantId,batchId,line.source_row,event.eventId,line.sheet_name]);
      const readback=(await db.query('SELECT on_hand,reserved_order,reserved_cart,damaged,quarantined FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenantId,line.master_sku_id,line.location_id])).rows[0];
      if (!readback || Number(readback.on_hand)!==Number(line.quantity) || ['reserved_order','reserved_cart','damaged','quarantined'].some(key => Number(readback[key])!==0)) throw new InventoryConflict('Opening-stock ledger readback did not match approved quantity');
      events.push({sourceRow:line.source_row,eventId:event.eventId});
    }
    const result={batchId,rows:lines.length,eventIds:events.map(row=>row.eventId),fileSha256:batch.file_sha256};
    await db.query("UPDATE ci_opening_stock_batch SET status='POSTED',posted_at=now(),result=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,batchId,result]);
    await audit(db,tenantId,batchId,'POSTING','POSTED',actor);
    await db.query("UPDATE ci_opening_stock_batch SET status='RECONCILED',reconciled_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,batchId]);
    await audit(db,tenantId,batchId,'POSTED','RECONCILED',actor);
    return { ...result,duplicate:false };
  });
}
