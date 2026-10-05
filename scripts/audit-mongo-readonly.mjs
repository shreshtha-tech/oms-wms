import '../env.js';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Mongo audit: MONGODB_URI is unset.');
  process.exit(2);
}

const database = process.env.MONGODB_DB || 'd_mills_global';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
try {
  await client.connect();
  const db = client.db(database);
  await db.command({ ping: 1 });
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
  const counts = {};
  for (const name of names) counts[name] = await db.collection(name).countDocuments({});
  console.log(JSON.stringify({ connected: true, database, collectionCount: names.length, counts }, null, 2));
} catch (error) {
  console.error('Mongo audit failed:', error.code || error.name || 'UNKNOWN_ERROR');
  process.exitCode = 1;
} finally {
  await client.close();
}
