import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { accessSync, constants } from 'node:fs';

// PG_BIN is a directory containing initdb/postgres/pg_dump; PG_BIN_DIR remains
// accepted for existing migration tooling. MONGOD_BIN is an executable path.
export function resolveTestBinary(name, env = process.env) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid test binary name');
  const override = name === 'mongod' ? env.MONGOD_BIN : (env.PG_BIN || env.PG_BIN_DIR);
  const candidates = override
    ? [name === 'mongod' ? override : join(override, name)]
    : (env.PATH || '').split(delimiter).filter(Boolean).map(directory => join(directory,name));
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new Error(`Test binary ${name} unavailable; set ${name === 'mongod' ? 'MONGOD_BIN' : 'PG_BIN'} or PATH`);
}

export function testBinaryPath(env = process.env) {
  const directories = [env.PG_BIN || env.PG_BIN_DIR, env.MONGOD_BIN && dirname(env.MONGOD_BIN), env.PATH].filter(Boolean);
  return directories.join(delimiter);
}
