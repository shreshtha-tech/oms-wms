import { createHash } from 'node:crypto';

// Caller must hold the ci-schema-migrations session lock. Keep replaying the
// existing idempotent SQL: history must not turn an unverified legacy schema
// into an assumed baseline, or disable the existing repair behavior.
export async function prepareMigrationHistory(client, migrations) {
  const names = new Set();
  const manifest = migrations.map(({ name, sql }) => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name) || names.has(name) || typeof sql !== 'string' || !sql.trim()) {
      throw Object.assign(new Error('Invalid or duplicate migration manifest entry'), { code: 'MIGRATION_MANIFEST_INVALID' });
    }
    names.add(name);
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
  await client.query(`CREATE TABLE IF NOT EXISTS ci_schema_migration (
    name text PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
    first_verified_at timestamptz NOT NULL DEFAULT now(),
    last_verified_at timestamptz NOT NULL DEFAULT now(),
    verification_count bigint NOT NULL DEFAULT 1 CHECK (verification_count > 0)
  )`);
  const previous = await client.query('SELECT name,checksum FROM ci_schema_migration ORDER BY name');
  const current = new Map(manifest.map(entry => [entry.name, entry.checksum]));
  for (const row of previous.rows) {
    if (!current.has(row.name)) throw Object.assign(new Error(`Previously recorded migration is missing: ${row.name}`), { code: 'MIGRATION_HISTORY_AHEAD' });
    if (current.get(row.name) !== row.checksum) throw Object.assign(new Error(`Migration checksum differs from the recorded version: ${row.name}`), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
  }
  return manifest;
}

// Record the whole sequence only after every SQL file and postcondition passes.
// A crash before this statement leaves the original replay/repair path intact.
// One SQL statement records all entries atomically; no historical SQL is skipped.
export async function recordMigrationHistory(client, manifest) {
  await client.query(`INSERT INTO ci_schema_migration (name,checksum)
    SELECT name,checksum FROM jsonb_to_recordset($1::jsonb) AS entry(name text,checksum text)
    ON CONFLICT (name) DO UPDATE SET last_verified_at=now(),
      verification_count=ci_schema_migration.verification_count+1`,
  [JSON.stringify(manifest.map(({ name, checksum }) => ({ name, checksum })))]);
}
