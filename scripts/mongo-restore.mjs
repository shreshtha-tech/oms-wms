// PROPOSAL: operator-reviewed additive restore to a new database. Never run by startup.
import '../env.js';
import { MongoClient, BSON } from 'mongodb';
import { realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { argumentsOf, requireRestoreTarget, isMain, safeFailure } from './mongo-tooling.mjs';
import { resolveMongoConfiguration } from '../api/mongo-config.js';
import { restoreDocumentBytes, insertRestoreBatches } from './mongo-restore-batches.mjs';
import { boundedBackupLines } from './mongo-backup-lines.mjs';
import { readRestoreManifest } from './mongo-restore-manifest.mjs';
async function* documents(file) {
  for await (const line of boundedBackupLines(createReadStream(file, { highWaterMark: 65536 }))) {
    if (!line) continue;
    const document = BSON.EJSON.parse(line, { relaxed: false });
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Invalid backup document.');
    yield document;
  }
}
export async function main(args = process.argv.slice(2), { env = process.env, Client = MongoClient, output = console.log } = {}) {
  const options = argumentsOf(args);
  const target = requireRestoreTarget(options);
  if (typeof options['--from'] !== 'string') throw new Error('Pass --from with a reviewed backup folder.');
  const folder = await realpath(options['--from']);
  const manifest = await readRestoreManifest(createReadStream(path.join(folder, 'manifest.json'), { highWaterMark: 65536 }));
  const seen = new Set(); let total = 0;
  for (const row of manifest.collections) {
    if (typeof row.name !== 'string' || row.name.startsWith('system.') || seen.has(row.name) || !/^\d+\.ndjson$/.test(row.file)) throw new Error('Invalid collection manifest.');
    seen.add(row.name);
    row.resolvedFile = await realpath(path.join(folder, row.file));
    if (path.dirname(row.resolvedFile) !== folder) throw new Error('Backup file escapes the reviewed folder.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(row.resolvedFile)) digest.update(chunk);
    if (digest.digest('hex') !== row.sha256) throw new Error('Backup integrity mismatch.');
    let count = 0;
    for await (const document of documents(row.resolvedFile)) { restoreDocumentBytes(document); count++; }
    if (count !== row.count) throw new Error('Backup count mismatch.');
    total += count;
  }
  if (options['--yes'] !== true || options['--dry-run'] === true) {
    output(JSON.stringify({ targetDatabase: target, dryRun: true, collections: seen.size, documents: total })); return;
  }
  // Explicit execution uses a new database only; partial failure leaves data for review.
  if (!env.MONGODB_URI) throw new Error('Configure the connection privately.');
  resolveMongoConfiguration(env);
  const client = new Client(env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect(); const db = client.db(target);
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('Restore requires a new database with no collections.');
    for (const row of manifest.collections) {
      // Preserve empty collections as well as document-bearing collections.
      // Collection options and secondary indexes still require reviewed migration.
      await db.createCollection(row.name);
      await insertRestoreBatches(db.collection(row.name), documents(row.resolvedFile));
    }
    output(JSON.stringify({ targetDatabase: target, collections: seen.size, documents: total, indexesRestored: false }));
  } finally { await client.close(); }
}
if (isMain(import.meta.url)) main().catch(safeFailure);
