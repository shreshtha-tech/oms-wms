export async function recoverExpiredPublications(db, tenantId, limit) {
  const uncertain = await db.query(`UPDATE ci_outbox SET status='held',lease_until=NULL,
    publication_state=CASE WHEN acknowledged_at IS NULL THEN 'UNKNOWN_REMOTE_STATE' ELSE 'READBACK_PENDING' END,
    last_error='Remote stock publication outcome requires provider readback after worker lease expiry'
    WHERE tenant_id=$1 AND id IN (
      SELECT id FROM ci_outbox WHERE tenant_id=$1 AND task_type='publish_stock' AND status='processing'
      AND remote_attempt_started_at IS NOT NULL AND lease_until<now()
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2
    ) RETURNING mapping_id,remote_target_quantity,publication_state`, [tenantId, limit]);
  for (const row of uncertain.rows) if (row.mapping_id && row.remote_target_quantity !== null) await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,target_quantity,publish_state,updated_at)
    VALUES($1,$2,$3,$4,now()) ON CONFLICT(tenant_id,mapping_id)
    DO UPDATE SET target_quantity=EXCLUDED.target_quantity,publish_state=EXCLUDED.publish_state,updated_at=now()`,
    [tenantId, row.mapping_id, row.remote_target_quantity, row.publication_state === 'READBACK_PENDING' ? 'readback_pending' : 'unknown_remote']);
}
