import { transaction } from './db.js';
import { applyInventoryEventInTransaction } from './ledger.js';
import { normalizeSkuCode } from './sku-parser.mjs';
import { queueProjection } from './sku-service.js';
import { isDeepStrictEqual } from 'node:util';

class MergeHold extends Error {
  constructor(reason, details = {}) { super(reason); this.code = 'VARIANT_MERGE_HELD'; this.reason = reason; this.details = details; }
}
const opening = row => ({ active: row.opening_stock_active ?? null, verified_at: row.opening_stock_verified_at instanceof Date ? row.opening_stock_verified_at.toISOString() : row.opening_stock_verified_at ?? null, verified_by: row.opening_stock_verified_by ?? null });
const qty = value => { const number = Number(value ?? 0); if (!Number.isSafeInteger(number) || number < 0) throw new MergeHold('INVALID_BALANCE'); return number; };
const balances = rows => rows.map(row => ({ location_id: row.location_id, on_hand: qty(row.on_hand), reserved_order: qty(row.reserved_order), reserved_cart: qty(row.reserved_cart), damaged: qty(row.damaged), quarantined: qty(row.quarantined), safety_stock: qty(row.safety_stock), version: qty(row.version) })).sort((a, b) => a.location_id.localeCompare(b.location_id));
const same = (a, b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const lockMasters = async (db, tenantId, ids) => (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [tenantId, ids])).rows;
const sourceBalances = async (db, tenantId, sourceId) => balances((await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 ORDER BY location_id FOR UPDATE', [tenantId, sourceId])).rows);
const activeReservations = async (db, tenantId, sourceId) => (await db.query("SELECT id,location_id,source,external_order_id,external_line_id FROM ci_reservation WHERE tenant_id=$1 AND master_sku_id=$2 AND status='active' ORDER BY id FOR UPDATE", [tenantId, sourceId])).rows;

async function targetFor(db, tenantId, group) {
  await db.query(`INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size,attr_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,'parsed') ON CONFLICT DO NOTHING`,
  [tenantId, group.canonical_sku, group.canonical_sku, group.category, group.product_type, group.color, group.size]);
  const target = (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND variant_key=$2 AND merged_into_id IS NULL', [tenantId, group.variant_key])).rows[0];
  if (!target || target.sku !== group.canonical_sku) throw new MergeHold('CANONICAL_IDENTITY_CONFLICT', { sku: group.canonical_sku });
  if (group.target_id && group.target_id !== target.id) throw new MergeHold('CANONICAL_TARGET_CHANGED');
  return target;
}

async function beginSource(tenantId, planHash, group, planned) {
  return transaction(async db => {
    const target = await targetFor(db, tenantId, group);
    const locked = await lockMasters(db, tenantId, [planned.id, target.id]);
    const source = locked.find(row => row.id === planned.id);
    if (!source || source.sku !== planned.sku) throw new MergeHold('SOURCE_IDENTITY_CHANGED');
    const audit = (await db.query('SELECT * FROM ci_variant_merge_audit WHERE tenant_id=$1 AND source_id=$2 FOR UPDATE', [tenantId, planned.id])).rows[0];
    if (audit) {
      if (audit.plan_hash !== planHash || audit.target_id !== target.id) throw new MergeHold('SOURCE_OWNED_BY_OTHER_PLAN');
      if (audit.status === 'done') {
        if (source.merged_into_id !== target.id || source.merge_in_progress) throw new MergeHold('COMPLETED_MERGE_STATE_MISMATCH');
        return { target, done: true };
      }
      if (!source.merge_in_progress || source.merged_into_id) throw new MergeHold('IN_PROGRESS_MERGE_STATE_MISMATCH');
      return { target, done: false };
    }
    if (source.merge_in_progress || source.merged_into_id) throw new MergeHold('SOURCE_ALREADY_MERGING');
    const reservations = await activeReservations(db, tenantId, source.id);
    if (reservations.length) throw new MergeHold('ACTIVE_RESERVATIONS', { reservations });
    const current = await sourceBalances(db, tenantId, source.id);
    if (!same(current, planned.balance_rows)) throw new MergeHold('SOURCE_BALANCE_CHANGED');
    if (current.some(row => row.reserved_order || row.reserved_cart)) throw new MergeHold('ENCUMBERED_SOURCE_BALANCE');
    if (!same(opening(source), opening(planned))) throw new MergeHold('OPENING_STOCK_EVIDENCE_CHANGED');
    if (source.opening_stock_active === true && target.opening_stock_active !== true) throw new MergeHold('OPENING_STOCK_TARGET_UNVERIFIED', { source: opening(source), target: opening(target) });
    await db.query('UPDATE ci_master_sku SET merge_in_progress=true WHERE tenant_id=$1 AND id=$2', [tenantId, source.id]);
    await db.query("INSERT INTO ci_variant_merge_audit(tenant_id,source_id,target_id,plan_hash,status,source_opening,target_opening) VALUES($1,$2,$3,$4,'applying',$5,$6)", [tenantId, source.id, target.id, planHash, opening(source), opening(target)]);
    return { target, done: false };
  });
}

async function transferLocation(tenantId, planHash, sourceId, targetId, locationId) {
  return transaction(async db => {
    const locked = await lockMasters(db, tenantId, [sourceId, targetId]);
    const source = locked.find(row => row.id === sourceId);
    if (!source?.merge_in_progress || source.merged_into_id) throw new MergeHold('SOURCE_NOT_IN_PROGRESS');
    const row = (await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 FOR UPDATE', [tenantId, sourceId, locationId])).rows[0];
    if (!row) throw new MergeHold('SOURCE_LOCATION_DISAPPEARED');
    const current = balances([row])[0];
    const key = `merge:${sourceId}:${targetId}:${locationId}`;
    const events = (await db.query('SELECT event_key FROM ci_inventory_event WHERE tenant_id=$1 AND event_key=ANY($2::text[])', [tenantId, [`${key}:out`, `${key}:in`]])).rows;
    if (events.length === 2) {
      if (current.on_hand || current.damaged || current.quarantined || current.safety_stock) throw new MergeHold('MERGE_REPLAY_BALANCE_CHANGED');
      return { duplicate: true };
    }
    if (events.length) throw new MergeHold('INCOMPLETE_MERGE_PAIR');
    if (current.reserved_order || current.reserved_cart) throw new MergeHold('ENCUMBERED_SOURCE_BALANCE');
    if (!current.on_hand && !current.damaged && !current.quarantined && !current.safety_stock) return { empty: true };
    if ((await activeReservations(db, tenantId, sourceId)).length) throw new MergeHold('ACTIVE_RESERVATIONS');
    const reference = JSON.stringify({ planHash, sourceId, targetId, locationId });
    const common = { tenantId, locationId, source: 'variant-backfill', externalReference: reference };
    await applyInventoryEventInTransaction(db, { ...common, masterSkuId: sourceId, eventKey: `${key}:out`, eventType: 'variant_merge_out', delta_on_hand: -current.on_hand, delta_damaged: -current.damaged, delta_quarantined: -current.quarantined, delta_safety_stock: -current.safety_stock });
    await applyInventoryEventInTransaction(db, { ...common, masterSkuId: targetId, eventKey: `${key}:in`, eventType: 'variant_merge_in', delta_on_hand: current.on_hand, delta_damaged: current.damaged, delta_quarantined: current.quarantined, delta_safety_stock: current.safety_stock });
    return { transferred: current.on_hand };
  });
}

async function finalizeSource(tenantId, planHash, group, planned, targetId) {
  return transaction(async db => {
    const locked = await lockMasters(db, tenantId, [planned.id, targetId]);
    const source = locked.find(row => row.id === planned.id), target = locked.find(row => row.id === targetId);
    if (!source?.merge_in_progress || source.merged_into_id || !target) throw new MergeHold('FINALIZE_STATE_CHANGED');
    const reservations = await activeReservations(db, tenantId, planned.id);
    if (reservations.length) throw new MergeHold('ACTIVE_RESERVATIONS', { reservations });
    const remaining = await sourceBalances(db, tenantId, planned.id);
    if (remaining.some(row => row.on_hand || row.reserved_order || row.reserved_cart || row.damaged || row.quarantined || row.safety_stock)) throw new MergeHold('SOURCE_STOCK_REMAINS');
    const rules = (await db.query('SELECT master_sku_id,threshold,enabled FROM ci_alert_rule WHERE tenant_id=$1 AND master_sku_id=ANY($2::uuid[]) FOR UPDATE', [tenantId, [planned.id, targetId]])).rows;
    if (rules.length === 2 && (rules[0].threshold !== rules[1].threshold || rules[0].enabled !== rules[1].enabled)) throw new MergeHold('ALERT_RULE_CONFLICT');
    const repointedMappings = (await db.query('UPDATE ci_channel_mapping SET master_sku_id=$3 WHERE tenant_id=$1 AND master_sku_id=$2 RETURNING id,account_id,internal_location_id,active', [tenantId, planned.id, targetId])).rows;
    for (const mapping of repointedMappings.filter(row => row.active && row.internal_location_id)) {
      await db.query('INSERT INTO ci_inventory_balance(tenant_id,master_sku_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tenantId, targetId, mapping.internal_location_id]);
      const account = (await db.query("SELECT platform FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND status='active'", [tenantId, mapping.account_id])).rows[0];
      if (account && ['shopify', 'amazon', 'woocommerce'].includes(account.platform)) await db.query("INSERT INTO ci_outbox(tenant_id,task_type,account_id,mapping_id,payload) VALUES($1,'publish_stock',$2,$3,$4) ON CONFLICT DO NOTHING", [tenantId, mapping.account_id, mapping.id, { source: 'variant_merge', planHash, sourceId: planned.id, targetId }]);
    }
    await db.query("UPDATE ci_unified_order_line l SET master_sku_id=$3 FROM ci_unified_order o WHERE l.tenant_id=$1 AND l.master_sku_id=$2 AND o.tenant_id=l.tenant_id AND o.id=l.order_id AND o.work_status IN ('new','accepted','packed')", [tenantId, planned.id, targetId]);
    await db.query('UPDATE ci_catalog_source_row SET master_sku_id=$3 WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, planned.id, targetId]);
    await db.query('UPDATE ci_program_stock SET master_sku_id=$3 WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, planned.id, targetId]);
    if (rules.length === 2) await db.query('DELETE FROM ci_alert_rule WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, planned.id]);
    else await db.query('UPDATE ci_alert_rule SET master_sku_id=$3 WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, planned.id, targetId]);
    await db.query('INSERT INTO ci_alert_sku_group_member(tenant_id,group_id,master_sku_id) SELECT tenant_id,group_id,$3 FROM ci_alert_sku_group_member WHERE tenant_id=$1 AND master_sku_id=$2 ON CONFLICT DO NOTHING', [tenantId, planned.id, targetId]);
    await db.query('DELETE FROM ci_alert_sku_group_member WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, planned.id]);
    const aliases = (await db.query('SELECT alias_sku,brand FROM ci_sku_alias WHERE tenant_id=$1 AND master_sku_id=$2 ORDER BY alias_sku FOR UPDATE', [tenantId, planned.id])).rows;
    const sourceAlias = normalizeSkuCode(planned.sku);
    if (aliases.some(row => row.alias_sku === sourceAlias && row.brand && planned.brand && normalizeSkuCode(row.brand) !== planned.brand)) throw new MergeHold('ALIAS_BRAND_CONFLICT');
    if (!aliases.some(row => row.alias_sku === sourceAlias)) aliases.push({ alias_sku: sourceAlias, brand: planned.brand });
    aliases.sort((a, b) => a.alias_sku.localeCompare(b.alias_sku));
    for (const alias of aliases) {
      const updated = await db.query('UPDATE ci_sku_alias SET master_sku_id=$3 WHERE tenant_id=$1 AND alias_sku=$2 AND master_sku_id=$4 RETURNING alias_sku', [tenantId, alias.alias_sku, targetId, planned.id]);
      if (!updated.rowCount) {
        const inserted = await db.query("INSERT INTO ci_sku_alias(tenant_id,alias_sku,master_sku_id,brand,source,parse_result) VALUES($1,$2,$3,$4,'legacy_master',$5) ON CONFLICT DO NOTHING RETURNING alias_sku", [tenantId, alias.alias_sku, targetId, alias.brand, { variantKey: group.variant_key, planHash }]);
        if (!inserted.rowCount) throw new MergeHold('ALIAS_OWNED_BY_OTHER_MASTER', { alias: alias.alias_sku });
      }
      await queueProjection(db, tenantId, alias.alias_sku, target, alias.brand, alias.alias_sku === sourceAlias ? planned.legacy_mongo_claim : null);
      await db.query("UPDATE ci_sku_projection_outbox SET status='held',reason='MERGED_SUPERSEDED',updated_at=now() WHERE tenant_id=$1 AND alias_sku=$2 AND master_sku_id=$3 AND status IN ('pending','retry')", [tenantId, alias.alias_sku, planned.id]);
    }
    await db.query("UPDATE ci_master_sku SET category=$3,product_type=$4,color=$5,size=$6,attr_status='parsed',merged_into_id=$7,merge_in_progress=false WHERE tenant_id=$1 AND id=$2", [tenantId, planned.id, group.category, group.product_type, group.color, group.size, targetId]);
    await db.query("UPDATE ci_variant_merge_audit SET status='done',completed_at=now() WHERE tenant_id=$1 AND source_id=$2 AND target_id=$3 AND plan_hash=$4 AND status='applying'", [tenantId, planned.id, targetId, planHash]);
    return { sourceId: planned.id, targetId, merged: true };
  });
}

export async function applyVariantBackfill({ tenantId, expectHash, currentPlan, reviewedMergeable, onLocationCommitted = null }) {
  if (!tenantId || !/^[a-f0-9]{64}$/.test(expectHash || '') || !Array.isArray(reviewedMergeable)) throw new TypeError('Tenant, reviewed merge list and plan hash are required');
  const plan = await transaction(async db => {
    const stored = (await db.query('SELECT plan_state FROM ci_variant_backfill_plan WHERE tenant_id=$1 AND plan_hash=$2 FOR UPDATE', [tenantId, expectHash])).rows[0]?.plan_state;
    if (stored) {
      if (!same(stored.mergeable, reviewedMergeable)) throw new MergeHold('PLAN_ARTIFACT_CHANGED');
      return stored;
    }
    if (!currentPlan || currentPlan.summary.sha256 !== expectHash || !same(currentPlan.mergeable, reviewedMergeable)) throw new MergeHold('PLAN_HASH_MISMATCH');
    await db.query('INSERT INTO ci_variant_backfill_plan(tenant_id,plan_hash,plan_state) VALUES($1,$2,$3)', [tenantId, expectHash, currentPlan]);
    return currentPlan;
  });
  const results = [];
  for (const group of plan.variants.filter(item => plan.mergeable.some(merge => merge.variant_key === item.variant_key))) {
    for (const planned of group.members.filter(member => member.id !== group.target_id)) {
      try {
        const started = await beginSource(tenantId, expectHash, group, planned);
        if (started.done) { results.push({ sourceId: planned.id, targetId: started.target.id, duplicate: true }); continue; }
        const locations = await transaction(async db => (await sourceBalances(db, tenantId, planned.id)).map(row => row.location_id));
        for (const locationId of locations) {
          await transferLocation(tenantId, expectHash, planned.id, started.target.id, locationId);
          if (onLocationCommitted) await onLocationCommitted({ sourceId: planned.id, targetId: started.target.id, locationId });
        }
        results.push(await finalizeSource(tenantId, expectHash, group, planned, started.target.id));
      } catch (error) {
        if (error?.code !== 'VARIANT_MERGE_HELD') throw error;
        results.push({ sourceId: planned.id, held: true, reason: error.reason, details: error.details });
      }
    }
  }
  return { planHash: expectHash, results };
}
