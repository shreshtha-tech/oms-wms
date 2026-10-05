import '../env.js';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Match private configured values in memory. Never emit values, snippets,
// lengths, URI hosts, authentication headers or hashes of secret material.
const candidates = [];
for (const [name, value] of Object.entries(process.env)) {
  if (!/^(?:MONGODB_URI|INVENTORY_DATABASE_URL|.*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CREDENTIAL_KEY))$/.test(name) || !value || value.length < 8) continue;
  candidates.push({ name, value });
  if (['MONGODB_URI', 'INVENTORY_DATABASE_URL'].includes(name)) {
    try { const password = decodeURIComponent(new URL(value).password); if (password.length >= 8) candidates.push({ name: `${name}:password`, value: password }); } catch {}
  }
}
const findings = [], skips = [];
const artifactsOnly = process.argv.includes('--artifacts-only');
function inspect(content, path, layer) {
  for (const { name, value } of candidates) {
    const offset = content.indexOf(value);
    if (offset >= 0) findings.push({ layer, path, source: name, line: content.slice(0, offset).split('\n').length, kind: 'CONFIGURED_VALUE_MATCH' });
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push({ layer, path, kind: 'PRIVATE_KEY_MARKER_REVIEW_REQUIRED' });
}
const paths = execFileSync('rg', ['--files', '--hidden', '--no-ignore', '-g', '!.git/**', '-g', '!node_modules/**', '-g', '!**/node_modules/**'], { encoding: 'utf8', maxBuffer: 20_000_000 }).trim().split('\n').filter(path=>!artifactsOnly || /^(dist|tmp)\//.test(path));
let scanned = 0;
for (const path of paths) {
  if (path === '.env') { skips.push({ path, reason: 'Expected private configuration source; values used only in memory' }); continue; }
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) continue;
  if (info.size > 8_000_000) { skips.push({ path, reason: 'Exceeds bounded per-file inspection size' }); continue; }
  const bytes = await readFile(path);
  if (bytes.includes(0)) { skips.push({ path, reason: 'Binary artifact requires format-aware inspection' }); continue; }
  inspect(bytes.toString('utf8'), path, 'WORKTREE'); scanned++;
}
const objects = artifactsOnly ? [] : execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8', maxBuffer: 20_000_000 }).trim().split('\n');
let historyScanned = 0, historyBytes = 0;
for (const entry of objects) {
  const space = entry.indexOf(' '); if (space < 0) continue;
  const oid = entry.slice(0, space), path = entry.slice(space + 1);
  if (execFileSync('git', ['cat-file', '-t', oid], { encoding: 'utf8' }).trim() !== 'blob') continue;
  const size = Number(execFileSync('git', ['cat-file', '-s', oid], { encoding: 'utf8' }));
  if (size > 8_000_000 || historyBytes + size > 100_000_000) { skips.push({ path, layer: 'GIT_HISTORY', reason: 'Bounded history byte limit' }); continue; }
  const bytes = execFileSync('git', ['cat-file', 'blob', oid], { maxBuffer: 8_000_001 }); historyBytes += size;
  if (bytes.includes(0)) { skips.push({ path, layer: 'GIT_HISTORY', reason: 'Binary history blob requires format-aware inspection' }); continue; }
  inspect(bytes.toString('utf8'), path, 'GIT_HISTORY'); historyScanned++;
}
const result = { at: new Date().toISOString(), method: 'Exact current configured-secret values plus private-key markers; no secret values emitted. Git reachable blobs are scanned with explicit bounds.', configuredSecretSources: [...new Set(candidates.map(candidate => candidate.name))], worktreeTextFilesScanned: scanned, historyTextBlobsScanned: historyScanned, findings, skips, limitations: ['Unknown/rotated/revoked secret values and generic high-entropy credentials need separate classification', 'Binary documents/archives, encrypted database records and browser storage need format-aware/authorized checks', 'Ignored files omitted by rg require separate discovery; this is not a complete no-secrets certification'] };
await writeFile(artifactsOnly?'docs/reliability/generated-secret-exposure-evidence.json':'docs/reliability/secret-exposure-evidence.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ worktreeTextFilesScanned: scanned, historyTextBlobsScanned: historyScanned, findings: findings.length, skipped: skips.length, productionReady: false }));
