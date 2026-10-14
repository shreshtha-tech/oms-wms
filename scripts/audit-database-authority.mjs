import { mongoModules, registryOnlyCollections, expectedMongoCollections } from '../api/mongo-collections.js';
import { readFile, readdir } from 'node:fs/promises';

const pgTables = new Set();
const migrationFiles = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(file => file.endsWith('.sql'));
for (const sql of await Promise.all(migrationFiles.map(file => readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8')))) {
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(ci_[a-z0-9_]+)/gi)) pgTables.add(match[1]);
}

const modules = Object.entries(mongoModules).sort(([a], [b]) => a.localeCompare(b));
const used = new Set(modules.flatMap(([, details]) => details.collections));
const missing = expectedMongoCollections.filter(name => !used.has(name));
if (missing.length) throw new Error(`Registry expected collection mismatch: ${missing.join(', ')}`);

const lines = [
  '# Mongo module ownership review — source inventory',
  '',
  'Generated from `api/mongo-collections.js` and PostgreSQL migration table declarations. This is a code-reference inventory, not configured-data evidence or an approved storage decision. A dynamic flag means the registry identified dynamic collection logic; it does not prove that a client can choose a database or collection.',
  '',
  `Observed route/module entries: ${modules.length}; referenced Mongo collections: ${used.size}; registry-only collections: ${registryOnlyCollections.length}; declared PostgreSQL ci_ tables: ${pgTables.size}.`,
  '',
  '| Module | Referenced Mongo collections | Dynamic collection logic | Ownership classification |',
  '|---|---|---|---|',
  ...modules.map(([source, details]) => `| \`${source}\` | ${details.collections.map(name => `\`${name}\``).join(', ')} | ${details.dynamic ? 'REVIEW' : 'No'} | BLOCKED_PENDING_ARCHITECTURAL_DECISION |`),
  '',
  'Registry-only collection names: ' + registryOnlyCollections.map(name => `\`${name}\``).join(', ') + '.',
  '',
  'Each row needs a field-level authority decision, tenant and role model, configured-data diagnosis, index/constraint plan, migration and rollback evidence before classification can become KEEP_IN_MONGO, MOVE_TO_POSTGRES, or HYBRID_WITH_EXPLICIT_BOUNDARY. See `docs/DATABASE_AUTHORITY_MATRIX.md` for current major-entity decisions. No database was connected or modified.',
];
process.stdout.write(lines.join('\n') + '\n');
