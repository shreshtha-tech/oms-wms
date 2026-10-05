import '../env.js';
import { MongoClient } from 'mongodb';
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
function classify(error) {
  if (!error) return undefined;
  return { name: error.name, code: error.code, codeName: error.codeName, cause: classify(error.cause), tlsAlert: /alert number (\d+)/.exec(error.message || '')?.[1] };
}
try { await client.connect(); await client.db(process.env.MONGODB_DB).command({ ping: 1 }); console.log(JSON.stringify({ connected: true })); }
catch (error) { console.log(JSON.stringify({ connected: false, error: classify(error), servers: [...error.reason?.servers?.values?.() || []].map(server => classify(server.error)) }, null, 2)); }
finally { await client.close(); }
