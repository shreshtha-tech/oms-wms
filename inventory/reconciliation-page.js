const cursors = new Map();
// Progress is process-local. Restarting repeats safe readback, never a write retry.
export async function readReconciliationPage(db, baseSql, tenantId, scope, kind = 'mapping') {
  if (!['mapping', 'task'].includes(kind)) throw new TypeError('Unknown reconciliation page kind');
  const key = `${kind}:${scope}:${tenantId}`;
  const column = kind === 'task' ? 'o.id' : 'm.id';
  const type = kind === 'task' ? 'bigint' : 'uuid';
  const resultKey = kind === 'task' ? 'task_id' : 'mapping_id';
  const sql = `${baseSql} AND ($2::${type} IS NULL OR ${column}>$2::${type}) ORDER BY ${column} LIMIT 100`;
  let after = cursors.get(key) || null;
  let result = await db.query(sql, [tenantId, after]);
  if (!result.rows.length && after) {
    after = null;
    result = await db.query(sql, [tenantId, after]);
  }
  if (!cursors.has(key) && cursors.size >= 128) cursors.delete(cursors.keys().next().value);
  cursors.set(key, result.rows.at(-1)?.[resultKey] || null);
  return result.rows;
}
