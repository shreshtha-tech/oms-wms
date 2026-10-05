import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveMongoConfiguration } from '../api/mongo-config.js';
export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function argumentsOf(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--') || options[args[i]] !== undefined) throw new Error('Invalid or duplicate tool argument.');
    const key = args[i];
    options[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  }
  return options;
}
export function requireSelectedDatabase(options, env = process.env, yes = false) {
  const config = resolveMongoConfiguration(env);
  if (typeof options['--db'] !== 'string' || options['--db'] !== config.selectedDatabase) throw new Error('Pass --db with the exact selected database name.');
  if (yes && options['--yes'] !== true) throw new Error('Explicit --yes is required.');
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI must be configured privately.');
  return config;
}
export function requireRestoreTarget(options) {
  const target = options['--target'];
  if (typeof target !== 'string' || !target || /[\/\\. "$\x00]/.test(target) || Buffer.byteLength(target) > 63) throw new Error('An explicit valid --target database name is required.');
  if (!target.endsWith('_test') && options['--i-understand-production'] !== true) throw new Error('Restore target must end in _test unless --i-understand-production is supplied.');
  return target;
}
export async function externalOutputFolder(input) {
  if (typeof input !== 'string') throw new Error('Pass --out with a new folder outside the repository.');
  const requested = path.resolve(input);
  const parent = await realpath(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  const relative = path.relative(await realpath(repositoryRoot), target);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Backup output must be outside the repository.');
  return target;
}
export async function inventoryMongo(client, selectedDatabase, expected) {
  let databases, visibility = 'May be limited to databases authorized for this identity.';
  try { databases = (await client.db('admin').admin().listDatabases({ nameOnly: true })).databases; }
  catch (error) {
    if (![13, 'Unauthorized'].includes(error.code) && error.codeName !== 'Unauthorized') throw new Error('Database listing failed; no credential-bearing driver error is printed.');
    try { databases = (await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true })).databases; }
    catch { databases = []; visibility = 'Database listing denied; selected database only. Other databases are unknown.'; }
  }
  const result = [];
  for (const name of [...new Set([...databases.map(row => row.name), selectedDatabase])].sort()) {
    const row = { database: name, collections: [], expectedPresent: [], expectedMissing: [] };
    try {
      const collections = await client.db(name).listCollections({}, { nameOnly: true, maxTimeMS: 5000 }).toArray();
      for (const collection of collections) {
        let count = null;
        try { count = await client.db(name).collection(collection.name).estimatedDocumentCount({ maxTimeMS: 5000 }); } catch {}
        row.collections.push({ name: collection.name, count });
      }
      row.expectedPresent = expected.filter(c => collections.some(row => row.name === c));
      row.expectedMissing = expected.filter(c => !row.expectedPresent.includes(c));
    } catch { row.inspection = 'ACCESS_OR_INSPECTION_UNAVAILABLE'; }
    result.push(row);
  }
  return { selectedDatabase, visibility, databases: result };
}
export function isMain(url) { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url); }
export function safeFailure() { console.error('Mongo tool failed. No credentials or document contents were printed. Check configuration, permissions and tool arguments.'); process.exitCode = 1; }
