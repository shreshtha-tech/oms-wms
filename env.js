// Loads .env into process.env before anything else imports the Supabase client.
// Imported first in server.js so ESM evaluates it before the api/* handlers.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.DMILLS_SKIP_DOTENV !== 'true' && !globalThis[Symbol.for('dmills.isolated.test')]) {
  dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
}
