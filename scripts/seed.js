// Create empty application collections without inserting sample business data.
import '../env.js';
import { MongoClient } from 'mongodb';
import { SEED } from '../api/seed.js';

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || 'd_mills_global';
if (!uri) {
  console.error('Set MONGODB_URI in .env before initializing MongoDB.');
  process.exit(1);
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const database = client.db(databaseName);
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name));
  let created = 0;
  for (const name of Object.keys(SEED)) {
    if (existing.has(name)) continue;
    await database.createCollection(name);
    created += 1;
  }
  console.log(`Created ${created} empty collections in ${databaseName}. Existing data was not changed.`);
} finally {
  await client.close();
}
