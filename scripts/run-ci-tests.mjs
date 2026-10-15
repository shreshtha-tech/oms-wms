// Keep service-backed tests sequential: owned PostgreSQL runners share fixtures.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadManifest(root) {
  const { scripts } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'ci-test-manifest.json'), 'utf8'));
  const names = Object.keys(scripts).filter(name => name.startsWith('test:')).sort();
  if (!names.length) throw new Error('No test:* scripts registered');
  if (manifest.version !== 1 || !manifest.tests || Array.isArray(manifest.tests)) throw new Error('Invalid CI manifest');
  const missing = names.filter(name => !Object.hasOwn(manifest.tests, name));
  const stale = Object.keys(manifest.tests).filter(name => !names.includes(name));
  if (missing.length || stale.length) throw new Error(`CI manifest mismatch: missing [${missing}], stale [${stale}]`);
  for (const name of names) {
    const entry = manifest.tests[name];
    if (!['required', 'quarantined'].includes(entry.tier) || !Array.isArray(entry.needs)
      || entry.needs.some(need => !['postgres', 'mongo-rs', 'browser'].includes(need))
      || new Set(entry.needs).size !== entry.needs.length
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || typeof entry.owner !== 'string' || !entry.owner.trim()
      || !Number.isSafeInteger(entry.timeoutSeconds) || entry.timeoutSeconds < 1 || entry.timeoutSeconds > 1800) {
      throw new Error(`Invalid CI manifest entry: ${name}`);
    }
  }
  return { names, scripts, tests: manifest.tests };
}

export function jobFor(needs) {
  return needs.includes('browser') ? 'browser' : needs.includes('mongo-rs') ? 'mongo' : 'hermetic';
}

export function testEnvironment(parent, needs) {
  // Only explicit test configuration enters children; no operator/provider secrets.
  const keys = ['PATH','HOME','TMPDIR','TEMP','TMP','LANG','CI','GITHUB_ACTIONS',
    'PG_BIN','PG_BIN_DIR','MONGOD_BIN','PLAYWRIGHT_BROWSERS_PATH','NODE_OPTIONS'];
  if (needs.includes('postgres')) keys.push('INVENTORY_DATABASE_URL','INVENTORY_DB_SSL','PGUSER');
  if (needs.includes('mongo-rs')) keys.push('MONGODB_URI','MONGODB_DB');
  const env = Object.fromEntries(keys.filter(key => parent[key] !== undefined).map(key => [key,parent[key]]));
  return { ...env, NODE_ENV: 'test', DMILLS_SKIP_DOTENV: 'true',
    DMILLS_REQUIRE_PERSISTENCE: needs.includes('mongo-rs') ? 'true' : 'false' };
}

export async function runTests({ root = process.cwd(), job = 'all', output = 'artifacts/ci-test-results.json', env = process.env, names: selected } = {}) {
  if (!['all','hermetic','mongo','browser'].includes(job)) throw new Error('Unknown CI job');
  const { names, tests } = await loadManifest(root); // Validate ALL entries even for one job.
  if (selected?.some(name => !names.includes(name))) throw new Error('Unknown selected test');
  const planned = names.filter(name => (!selected || selected.includes(name)) && (job === 'all' || jobFor(tests[name].needs) === job));
  const report = { version: 1, node: process.version, job, registered: names.length,
    startedAt: new Date().toISOString(), total: planned.length, completed: 0,
    results: planned.map(name => ({ name, command: `npm run ${name}`, ...tests[name], status: 'NOT RUN' })) };
  const target = resolve(root, output);
  await mkdir(dirname(target), { recursive: true });
  const save = async () => {
    await writeFile(`${target}.tmp`, JSON.stringify(report,null,2)+'\n');
    await rename(`${target}.tmp`, target);
  };
  await save();
  for (const result of report.results) {
    console.log(`\n$ ${result.command} [${result.tier}]`);
    const started = Date.now();
    const childEnv = testEnvironment(env, result.needs);
    const outcome = await new Promise(resolveOutcome => {
      const child = spawn('npm', ['run', result.name], { cwd: root, env: childEnv, stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32' });
      let stdout = '', stderr = '', timedOut = false, killTimer;
      child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
      child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
      const kill = signal => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
      const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 5000); }, result.timeoutSeconds * 1000);
      child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); resolveOutcome({ status:'FAIL', error:error.code, stdout, stderr }); });
      child.once('close', (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); resolveOutcome({ status:code === 0 && !timedOut ? 'PASS' : 'FAIL', code, signal, timedOut, stdout, stderr }); });
    });
    Object.assign(result, outcome, { durationMs: Date.now()-started });
    report.completed++;
    await save();
    console.log(`${result.name}: ${result.status} (${result.tier})`);
  }
  report.finishedAt = new Date().toISOString();
  report.requiredFailures = report.results.filter(result => result.tier === 'required' && result.status !== 'PASS').length;
  report.quarantinedFailures = report.results.filter(result => result.tier === 'quarantined' && result.status !== 'PASS').length;
  await save();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = Object.fromEntries(process.argv.slice(2).map(arg => {
      const match = /^--(job|tier|output)=(.+)$/.exec(arg);
      if (!match) throw new Error(`Unknown option: ${arg}`);
      return [match[1],match[2]];
    }));
    if (options.tier && options.tier !== 'required') throw new Error('Only --tier=required is supported; quarantined tests still run');
    const report = await runTests(options);
    console.log(`Required failures: ${report.requiredFailures}; quarantined failures: ${report.quarantinedFailures}`);
    process.exitCode = report.requiredFailures ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
