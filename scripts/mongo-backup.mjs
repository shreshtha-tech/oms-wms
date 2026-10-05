import '../env.js';
import { MongoClient, BSON } from 'mongodb';
import { mkdir, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { argumentsOf, requireSelectedDatabase, externalOutputFolder, isMain, safeFailure } from './mongo-tooling.mjs';
export async function main(args = process.argv.slice(2), { env = process.env, Client = MongoClient, output = console.log } = {}) {
  const options = argumentsOf(args);
  const config = requireSelectedDatabase(options, env, true);
  const folder = await externalOutputFolder(options['--out']);
  const client = new Client(env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(config.selectedDatabase);
    const collections = await db.listCollections({}, { nameOnly: false }).toArray();
    if (collections.some(row => row.type !== 'collection')) throw new Error('Views require a separate reviewed export contract.');
    await mkdir(folder, { mode: 0o700 });
    const manifest = { format: 'dmills-canonical-ejson-v1', database: config.selectedDatabase, complete: false, consistentSnapshot: false, collections: [] };
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    for (const [index, collection] of collections.entries()) {
      const file = `${index}.ndjson`;
      const handle = await open(path.join(folder, file), 'wx', 0o600);
      let count = 0;
      const digest = createHash('sha256');
      try { for await (const document of db.collection(collection.name).find({})) { const line = BSON.EJSON.stringify(document, { relaxed: false }) + '\n'; digest.update(line); await handle.writeFile(line); count++; } }
      finally { await handle.close(); }
      const indexes = await db.collection(collection.name).listIndexes().toArray();
      manifest.collections.push({ name: collection.name, file, count, sha256: digest.digest('hex'), options: collection.options, indexes });
    }
    manifest.complete = true;
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    output(JSON.stringify({ database: config.selectedDatabase, collectionCount: manifest.collections.length, documentCount: manifest.collections.reduce((n, row) => n + row.count, 0), consistentSnapshot: false }));
  } finally { await client.close(); }
}
if (isMain(import.meta.url)) main().catch(safeFailure);
