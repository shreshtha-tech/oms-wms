import { expectedMongoCollections } from './mongo-collections.js';

export async function inspectMongoDataset(db, expected = expectedMongoCollections) {
  const deadline = Date.now() + 10000;
  const names = new Set((await db.listCollections({}, { nameOnly: true, maxTimeMS: 5000 }).toArray()).map(row => row.name));
  const present = expected.filter(name => names.has(name));
  let populatedCollections = 0;
  for (const name of present) {
    if (Date.now() >= deadline) throw new Error('Dataset inspection deadline exceeded');
    if (await db.collection(name).estimatedDocumentCount({ maxTimeMS: 5000 }) > 0) populatedCollections++;
  }
  return {
    datasetState: populatedCollections ? 'POPULATED' : 'EMPTY_UNINITIALISED',
    datasetEmpty: populatedCollections === 0,
    expectedCollections: expected.length,
    presentCollections: present.length,
    populatedCollections,
  };
}
