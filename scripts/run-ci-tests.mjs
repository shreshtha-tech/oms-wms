// Execute the package registry sequentially: shared fixtures must not race.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const names = Object.keys(scripts).filter(name => name.startsWith('test:')).sort();
if (!names.length) throw new Error('No test:* scripts registered');
const results = [];
for (const name of names) {
  console.log(`\nRunning ${name}`);
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn('npm', ['run', name], { stdio: 'inherit', env: process.env });
    child.once('error', error => resolve({ status: 'FAIL', error: error.code }));
    child.once('exit', (code, signal) => resolve({ status: code === 0 ? 'PASS' : 'FAIL', code, signal }));
  });
  results.push({ name, ...result, durationMs: Date.now() - started });
  console.log(`${name}: ${result.status}`);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/ci-test-results.json', JSON.stringify({ total: names.length, completed: results.length, results }, null, 2) + '\n');
}
process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0;
