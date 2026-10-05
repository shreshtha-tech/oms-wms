import assert from 'node:assert/strict';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';
validateTestStores(process.env);
await import('../env.js');
assert.equal(process.env.AUTH_PASSWORD, undefined);
import { MongoClient } from 'mongodb';
import pg from 'pg';
const mongo = new MongoClient(process.env.MONGODB_URI);
const postgres = new pg.Client({ connectionString: process.env.INVENTORY_DATABASE_URL });
try {
  await mongo.connect(); await postgres.connect();
  const db = mongo.db(process.env.MONGODB_DB);
  await db.createCollection('stack_probe');
  const session = mongo.startSession();
  await assert.rejects(session.withTransaction(async () => {
    await db.collection('stack_probe').insertOne({ _id: 'aborted' }, { session });
    throw new Error('Synthetic abort');
  }));
  assert.equal(await db.collection('stack_probe').countDocuments(), 0);
  const stream = db.collection('stack_probe').watch([], { maxAwaitTimeMS: 100 });
  const pending = stream.next();
  await new Promise(resolve => setTimeout(resolve, 150));
  await session.withTransaction(() => db.collection('stack_probe').insertOne({ _id: 'committed' }, { session }));
  const change = await pending;
  assert.equal(change.documentKey._id, 'committed');
  await db.collection('test_cursor').insertOne({ _id: 'cursor', token: change._id });
  await stream.close();
  const cursor = await db.collection('test_cursor').findOne({ _id: 'cursor' });
  const resumed = db.collection('stack_probe').watch([], { resumeAfter: cursor.token });
  const next = resumed.next();
  await db.collection('stack_probe').insertOne({ _id: 'after_resume' });
  assert.equal((await next).documentKey._id, 'after_resume');
  await resumed.close(); await session.endSession();
  await postgres.query('CREATE TABLE stack_probe (id integer PRIMARY KEY)');
  await postgres.query('BEGIN'); await postgres.query('INSERT INTO stack_probe VALUES (1)'); await postgres.query('ROLLBACK');
  assert.equal((await postgres.query('SELECT count(*)::int AS n FROM stack_probe')).rows[0].n, 0);
  console.log('PASS: Mongo transaction abort/commit, change stream durable token/resume, PG rollback on fresh _test stores.');
} finally { await mongo.close(); await postgres.end(); }
