import '../env.js';
import { MongoClient } from 'mongodb';
import { expectedMongoCollections } from '../api/mongo-collections.js';
import { argumentsOf, requireSelectedDatabase, inventoryMongo, isMain, safeFailure } from './mongo-tooling.mjs';
export async function main(args = process.argv.slice(2)) {
  const config = requireSelectedDatabase(argumentsOf(args));
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  try { await client.connect(); console.log(JSON.stringify({ maskedHost: config.maskedHost, ...await inventoryMongo(client, config.selectedDatabase, expectedMongoCollections) }, null, 2)); }
  finally { await client.close(); }
}
if (isMain(import.meta.url)) main().catch(safeFailure);
