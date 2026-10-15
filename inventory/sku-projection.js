import { randomUUID } from 'node:crypto';
import { ensureIndex, mongoDomainTransaction } from '../api/mongo.js';
import { inventoryPool } from './db.js';

const leaseMs = 120000;
const conflict = reason => Object.assign(new Error('SKU projection requires review'), { code: 'SKU_PROJECTION_CONFLICT', reason });
const retryMs = attempts => Math.min(60000, 1000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));
const markerFor = row => ({ tenant_id: row.tenant_id, alias_sku: row.alias_sku, master_sku_id: row.master_sku_id, revision: Number(row.revision), digest: row.payload_digest });
const sameProjection = (doc, row) => {
  const marker = markerFor(row);
  return doc?.ci_projection && Object.entries(marker).every(([key, value]) => doc.ci_projection[key] === value)
    && Object.entries(row.payload).every(([key, value]) => doc[key] === value);
};

async function findProjected(db, session, row) {
  return db.collection('skus').findOne(
    { sku_code: row.alias_sku },
    { session, collation: { locale: 'en', strength: 2 } },
  );
}

async function ensureSkuCodeIndex() {
  await ensureIndex('skus', { sku_code: 1 }, {
    name: 'uq_master_sku_code', unique: true,
    partialFilterExpression: { sku_code: { $type: 'string' } },
    collation: { locale: 'en', strength: 2 },
  });
}

async function project(row) {
  const marker = markerFor(row);
  return mongoDomainTransaction(async (db, session) => {
    const skus = db.collection('skus');
    const prior = await findProjected(db, session, row);
    if (prior) {
      if (prior.tenant_id !== row.tenant_id) throw conflict('LEGACY_TENANT_UNVERIFIED');
      const remote = prior.ci_projection;
      if (remote && (remote.tenant_id !== row.tenant_id || remote.alias_sku !== row.alias_sku || remote.master_sku_id !== row.master_sku_id)) throw conflict('REMOTE_IDENTITY_MISMATCH');
      if (remote && Number(remote.revision) > Number(row.revision)) return { superseded: true };
      if (remote && Number(remote.revision) === Number(row.revision)) {
        if (!sameProjection(prior, row)) throw conflict('REVISION_DIGEST_MISMATCH');
        return { duplicate: true };
      }
      await skus.updateOne({ _id: prior._id, tenant_id: row.tenant_id }, { $set: { ...row.payload, ci_projection: marker } }, { session });
      return { updated: true };
    }
    const top = await skus.find({}, { session, projection: { id: 1 } }).sort({ id: -1 }).limit(1).next();
    await db.collection('_counters').updateOne({ _id: 'skus' }, { $max: { seq: Number(top?.id) || 0 } }, { session, upsert: true });
    const counter = await db.collection('_counters').findOneAndUpdate({ _id: 'skus' }, { $inc: { seq: 1 } }, { session, returnDocument: 'after', includeResultMetadata: false });
    await skus.insertOne({ ...row.payload, id: counter.seq, tenant_id: row.tenant_id, ci_projection: marker }, { session });
    return { created: true };
  });
}

async function readback(row) {
  return mongoDomainTransaction(async (db, session) => {
    const doc = await findProjected(db, session, row);
    if (!doc) return false;
    if (sameProjection(doc, row)) return true;
    const marker = doc.ci_projection;
    return marker?.tenant_id === row.tenant_id && marker?.alias_sku === row.alias_sku
      && marker?.master_sku_id === row.master_sku_id && Number(marker.revision) > Number(row.revision);
  });
}

async function markRow(db, row, claimToken, status, reason = null, availableMs = 0) {
  await db.query(
    "UPDATE ci_sku_projection_outbox SET status=$4,reason=$5,available_at=now()+($6::text||' milliseconds')::interval,claim_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND claim_token=$3 AND status='processing'",
    [row.id, row.tenant_id, claimToken, status, reason, availableMs],
  );
}

export async function runSkuProjectionBatch(limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('SKU projection batch size must be 1 to 100');
  const tenantId = process.env.INVENTORY_ALLOWED_TENANT_ID;
  if (!tenantId) throw Object.assign(new Error('SKU projection tenant unavailable'), { code: 'SKU_TENANT_UNAVAILABLE', status: 503 });
  const db = inventoryPool();
  // Expired processing leases may have committed remotely; only readback can
  // resolve them. Never put them straight back into the send queue.
  await db.query("UPDATE ci_sku_projection_outbox SET status='unknown_remote',reason='LEASE_EXPIRED',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND status='processing' AND lease_until<=now()", [tenantId]);
  await db.query("UPDATE ci_sku_projection_outbox SET status='dead',reason='RETRY_EXHAUSTED',updated_at=now() WHERE tenant_id=$1 AND status IN ('pending','retry') AND attempts>=8", [tenantId]);
  const uncertain = await db.query("SELECT * FROM ci_sku_projection_outbox WHERE tenant_id=$1 AND status='unknown_remote' ORDER BY id LIMIT $2", [tenantId, limit]);
  let recovered = 0;
  for (const row of uncertain.rows) {
    if (await readback(row)) {
      await db.query("UPDATE ci_sku_projection_outbox SET status='done',reason=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='unknown_remote'", [row.id, tenantId]);
      recovered++;
    }
  }
  const pending = await db.query("SELECT count(*)::int AS n FROM ci_sku_projection_outbox WHERE tenant_id=$1 AND status IN ('pending','retry') AND available_at<=now()", [tenantId]);
  if (!pending.rows[0].n) return { projected: 0, recovered };
  await ensureSkuCodeIndex();
  let projected = 0;
  for (let index = 0; index < limit; index++) {
    const claimToken = randomUUID();
    const row = (await db.query(`WITH picked AS (
      SELECT id FROM ci_sku_projection_outbox
      WHERE tenant_id=$1 AND status IN ('pending','retry') AND available_at<=now() AND attempts<8
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE ci_sku_projection_outbox o SET status='processing',claim_token=$2,
      lease_until=now()+($3::text||' milliseconds')::interval,attempts=attempts+1,updated_at=now()
    FROM picked WHERE o.id=picked.id RETURNING o.*`, [tenantId, claimToken, leaseMs])).rows[0];
    if (!row) break;
    try {
      await project(row);
      await markRow(db, row, claimToken, 'done');
      projected++;
    } catch (error) {
      const uncertainResult = ['DATABASE_COMMIT_UNCERTAIN', 'DATABASE_TIMEOUT'].includes(error?.code);
      const held = error?.code === 'SKU_PROJECTION_CONFLICT';
      const exhausted = Number(row.attempts) >= 8;
      const status = uncertainResult ? 'unknown_remote' : held ? 'held' : exhausted ? 'dead' : 'retry';
      const reason = uncertainResult ? 'COMMIT_UNCERTAIN' : held ? error.reason : exhausted ? 'RETRY_EXHAUSTED' : 'DEPENDENCY_FAILURE';
      await markRow(db, row, claimToken, status, reason, status === 'retry' ? retryMs(Number(row.attempts)) : 0);
      if (status === 'retry' && error?.code === 'DATABASE_UNAVAILABLE') break;
    }
  }
  return { projected, recovered };
}
