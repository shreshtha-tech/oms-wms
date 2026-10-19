import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { inventoryPool, transaction } from './db.js';
import { applyInventoryEventInTransaction } from './ledger.js';
import { evaluateStockAlert } from './alerts.js';
import { readInventoryOverview, readInventorySummary } from './read-model.js';
import { inventoryFilesApi } from './files-api.js';
import { requirePermission } from '../api/auth-session.js';
import { publicationStatusError } from './publication-status-error.js';
import { upsertMaster } from './sku-service.js';

export const centralInventoryApi=express.Router();
centralInventoryApi.use(inventoryFilesApi);
const fail=(res,error)=>sendDatabaseError(res,error)||res.status(error.status||400).json({error:error.message||'Inventory request failed'});
const positiveInteger=value=>Number.isSafeInteger(value)&&value>=0;

centralInventoryApi.get('/summary',async(req,res)=>{
  try{
    res.json(await readInventorySummary(req.inventoryTenantId));
  }catch{res.status(503).json({error:'Central inventory database unavailable'});}
});

centralInventoryApi.get('/overview',async(req,res)=>{
  try{res.json(await readInventoryOverview(req.inventoryTenantId));}
  catch{res.status(503).json({error:'Central inventory database unavailable'});}
});

centralInventoryApi.get('/publication-status',async(req,res)=>{
  try{
    const page=Number(req.query.page||1),scope=String(req.query.scope||'attention');
    if(!Number.isSafeInteger(page)||page<1||page>100000||!['attention','all'].includes(scope))return res.status(400).json({error:'Invalid publication page or scope'});
    const where=scope==='attention'?`AND (cs.publish_state IN ('unknown_remote','requires_reconciliation','pending','submitted') OR task.status='held')`:'';
    const from=`FROM ci_channel_mapping m
      JOIN ci_master_sku s ON s.tenant_id=m.tenant_id AND s.id=m.master_sku_id
      JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id
      LEFT JOIN ci_channel_stock cs ON cs.tenant_id=m.tenant_id AND cs.mapping_id=m.id
      LEFT JOIN LATERAL (SELECT o.status,o.attempts,o.remote_target_quantity,o.remote_attempt_started_at,o.publication_state,
          o.provider_platform,o.internal_sku_id,o.internal_location_id,o.external_sku,o.provider_listing_id,o.provider_location_id,
          o.pack_size,o.source_event_id,o.remote_request_id,o.provider_response_reference,o.acknowledged_at,
          o.readback_quantity AS task_readback_quantity,o.readback_at AS task_readback_at,o.reconciliation_result
        FROM ci_outbox o WHERE o.tenant_id=m.tenant_id AND o.mapping_id=m.id AND o.task_type='publish_stock'
        ORDER BY (o.status='held') DESC,o.id DESC LIMIT 1) task ON true
      WHERE m.tenant_id=$1 ${where}`;
    const db=inventoryPool();
    const [total,rows]=await Promise.all([
      db.query(`SELECT count(*)::integer AS count ${from}`,[req.inventoryTenantId]),
      db.query(`SELECT m.id AS mapping_id,s.sku,a.platform,a.external_account_id,m.external_sku,m.external_location_id,
        cs.target_quantity,cs.observed_quantity,cs.observed_at,cs.readback_quantity,cs.readback_at,
        cs.publish_state,cs.updated_at AS publication_updated_at,task.status AS task_status,
        task.attempts,task.remote_target_quantity,task.remote_attempt_started_at,task.publication_state,
        task.provider_platform,task.internal_sku_id,task.internal_location_id,task.external_sku,task.provider_listing_id,
        task.provider_location_id,task.pack_size,task.source_event_id,task.remote_request_id,task.provider_response_reference,
        task.acknowledged_at,task.task_readback_quantity,task.task_readback_at,task.reconciliation_result
        ${from} ORDER BY (task.status='held') DESC,cs.updated_at DESC NULLS LAST,m.id LIMIT 100 OFFSET $2`,
        [req.inventoryTenantId,(page-1)*100]),
    ]);
    res.set('Cache-Control','no-store').json({rows:rows.rows,total:total.rows[0].count,page,pageSize:100,scope,generatedAt:new Date().toISOString()});
  }catch(error){
    const failure=publicationStatusError(error);
    const databaseCode=typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error('publication status query failed', { code: failure.body.code, databaseCode });
    res.status(failure.status).json(failure.body);
  }
});

centralInventoryApi.get('/events',async(req,res)=>{
  try{
    const rows=await inventoryPool().query("SELECT e.id,e.event_key,e.event_type,e.source,e.external_reference,e.delta_on_hand,e.delta_reserved_order,e.created_at,s.sku,l.code AS location FROM ci_inventory_event e JOIN ci_master_sku s ON s.tenant_id=e.tenant_id AND s.id=e.master_sku_id JOIN ci_location l ON l.tenant_id=e.tenant_id AND l.id=e.location_id WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT 100",[req.inventoryTenantId]);
    res.json(rows.rows);
  }catch{res.status(503).json({error:'Central inventory database unavailable'});}
});

centralInventoryApi.post('/products',requirePermission('central_inventory.master_data.write'),async(req,res)=>{
  try{
    const sku=String(req.body?.sku||'').trim(),name=String(req.body?.productName||'').trim();
    if(!sku||sku.length>120||!name||name.length>250)throw new Error('SKU and product name are required');
    const result=await transaction(db=>upsertMaster(db,{tenantId:req.inventoryTenantId,sku,productName:name,source:'manual',createOnly:true}));
    res.status(201).json({id:result.id,sku:result.sku,product_name:result.product_name,aliasSku:result.aliasSku,attrStatus:result.attr_status,reviewIssues:result.reviewIssues});
  }catch(error){if(error.code==='23505')return res.status(409).json({error:'SKU already exists'});fail(res,error);}
});

centralInventoryApi.post('/locations',requirePermission('central_inventory.master_data.write'),async(req,res)=>{
  try{
    const code=String(req.body?.code||'').trim(),type=String(req.body?.locationType||'');
    if(!code||code.length>120||!['warehouse','store','qcommerce_darkstore','marketplace_custody'].includes(type))throw new Error('Valid location code and type are required');
    const result=await inventoryPool().query('INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,$2,$3) RETURNING id,code,location_type',[req.inventoryTenantId,code,type]);
    res.status(201).json(result.rows[0]);
  }catch(error){if(error.code==='23505')return res.status(409).json({error:'Location already exists'});fail(res,error);}
});

centralInventoryApi.post('/adjustments',requirePermission('central_inventory.stock_adjustment.write'),async(req,res)=>{
  try{
    const tenant=req.inventoryTenantId,{masterSkuId,locationId,mode,quantity,alertThreshold}=req.body||{};
    const reason=String(req.body?.reason||'').trim(),requestId=String(req.body?.requestId||'').trim();
    if(!['set','delta'].includes(mode)||!Number.isSafeInteger(quantity)||!reason||reason.length>250||!requestId||requestId.length>160)throw new Error('Mode, integer quantity, reason and request ID are required');
    if(mode==='set'&&!positiveInteger(quantity))throw new Error('Absolute quantity cannot be negative');
    if(alertThreshold!==undefined&&!positiveInteger(alertThreshold))throw new Error('Low-stock threshold must be a nonnegative whole number');
    const result=await transaction(async db=>{
      const identity=await db.query("SELECT s.id FROM ci_master_sku s JOIN ci_location l ON l.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.id=$2 AND l.id=$3 AND l.location_type IN ('warehouse','store')",[tenant,masterSkuId,locationId]);
      if(identity.rowCount!==1)throw new Error('Physical SKU or warehouse/store location not found');
      await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,masterSkuId]);
      const balance=await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 FOR UPDATE',[tenant,masterSkuId,locationId]);
      if(!balance.rowCount)throw Object.assign(new Error('No verified stock basis exists for this SKU/location. Use the controlled opening-stock approval workflow.'),{status:409});
      const reference=JSON.stringify({mode,quantity,reason,...(alertThreshold!==undefined?{alertThreshold}:{})});
      const prior=await db.query('SELECT id,master_sku_id,location_id,external_reference FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=$2',[tenant,`manual:${requestId}`]);
      if(prior.rowCount){
        const event=prior.rows[0];
        if(event.master_sku_id!==masterSkuId||event.location_id!==locationId||event.external_reference!==reference)throw Object.assign(new Error('Request ID was already used for a different adjustment'),{status:409});
        return {duplicate:true,eventId:event.id};
      }
      const delta=mode==='set'?quantity-Number(balance.rows[0].on_hand):quantity;
      if(alertThreshold!==undefined)await db.query('INSERT INTO ci_alert_rule(tenant_id,master_sku_id,threshold,enabled) VALUES($1,$2,$3,true) ON CONFLICT(tenant_id,master_sku_id) DO UPDATE SET threshold=EXCLUDED.threshold,enabled=true,updated_at=now()',[tenant,masterSkuId,alertThreshold]);
      return applyInventoryEventInTransaction(db,{tenantId:tenant,masterSkuId,locationId,eventKey:`manual:${requestId}`,eventType:mode==='set'?'physical_count':'manual_adjustment',source:'central_ui',externalReference:reference,delta_on_hand:delta});
    });
    res.status(result.duplicate?200:201).json(result);
  }catch(error){fail(res,error);}
});

centralInventoryApi.post('/alert-rules',requirePermission('central_inventory.alerts.manage'),async(req,res)=>{
  try{
    const tenant=req.inventoryTenantId,{masterSkuIds,threshold,enabled=true}=req.body||{};
    if(!Array.isArray(masterSkuIds)||!masterSkuIds.length||masterSkuIds.length>5000||!positiveInteger(threshold)||typeof enabled!=='boolean')throw new Error('Select 1–5000 SKUs and a nonnegative alert threshold');
    const ids=[...new Set(masterSkuIds.map(String))].sort();
    const result=await transaction(async db=>{
      const found=await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,ids]);
      if(found.rowCount!==ids.length)throw new Error('One or more SKUs are not in this tenant');
      for(const id of ids){
        await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id]);
        await db.query('INSERT INTO ci_alert_rule(tenant_id,master_sku_id,threshold,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,master_sku_id) DO UPDATE SET threshold=EXCLUDED.threshold,enabled=EXCLUDED.enabled,updated_at=now()',[tenant,id,threshold,enabled]);
        await evaluateStockAlert(db,tenant,id);
      }
      return {updated:ids.length};
    });
    res.json(result);
  }catch(error){fail(res,error);}
});
