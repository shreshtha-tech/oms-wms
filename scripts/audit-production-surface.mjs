// Read-only source inventory. Candidate counts are not vulnerability verdicts.
// Never imports application modules, loads .env, or emits matching source text.
import { execFileSync } from 'node:child_process';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'docs/hardening/source-surface.json');
const roots = ['api', 'inventory', 'reliability', 'src', 'db', 'scripts', 'docs'];
const paths = execFileSync('rg', ['--files', ...roots], { cwd: root, encoding: 'utf8', maxBuffer: 8_000_000 })
  .trim().split('\n').filter(path => /\.(?:[cm]?js|tsx?|sql|md|json|ya?ml|csv)$/.test(path));
paths.push('server.js', 'package.json', 'package-lock.json', 'render.yaml', 'vite.config.ts');
const checks = [
  ['postgres-query', /\.query\s*\(/],
  ['mongo-write', /\.(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|bulkWrite)\s*\(/],
  ['external-request', /\b(?:fetch|providerFetch|providerCall)\s*\(/],
  ['parallel-work', /Promise\.all(?:Settled)?\s*\(/],
  ['timer', /\bset(?:Interval|Timeout)\s*\(/],
  ['browser-storage', /\b(?:localStorage|sessionStorage|indexedDB)\b/],
  ['html-sink', /dangerouslySetInnerHTML|\.innerHTML\s*=/],
  ['process-execution', /child_process|\b(?:eval|new Function)\s*\(/],
  ['file-parser', /exceljs|xlsx|xml2js|fast-xml-parser|\.xlsx\.load|JSON\.parse/],
  ['permission-check', /requirePermission|hasPermission/],
  ['transaction-boundary', /\b(?:BEGIN|COMMIT|ROLLBACK|withTransaction)\b/],
];
const files = [], candidates = [], routes = [], excluded = [];
for (const path of [...new Set(paths)].sort()) {
  if (path === relative(root, destination)) continue;
  let metadata;
  try { metadata = await stat(resolve(root, path)); } catch { excluded.push({ path, reason: 'unavailable' }); continue; }
  if (metadata.size > 2_000_000) { excluded.push({ path, reason: 'over-2MB-scan-budget', bytes: metadata.size }); continue; }
  const source = await readFile(resolve(root, path), 'utf8');
  const lines = source.split('\n');
  const area = path.split('/')[0];
  const executable = /\.(?:[cm]?js|tsx?|sql)$/.test(path);
  files.push({ path, area, bytes: metadata.size, lines: lines.length, review: 'AUTOMATED_INVENTORY_ONLY' });
  if (!executable) continue;
  lines.forEach((line, index) => {
    for (const [category, pattern] of checks) {
      if (pattern.test(line)) candidates.push({ path, line: index + 1, category, verdict: 'REQUIRES_CONTEXT_REVIEW' });
    }
    // Route registration candidates only; mounted paths and middleware need tracing.
    const pattern = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\s*\(\s*(['"])(\/[^'"\r\n]*)\3/g;
    for (const match of line.matchAll(pattern)) {
      routes.push({ path, line: index + 1, router: match[1], method: match[2].toUpperCase(), route: match[4], review: 'MOUNT_AND_AUTH_NOT_YET_VERIFIED' });
    }
    if (path === 'server.js') {
      const mount = line.match(/^\s*['"](\/api\/[^'"]+)['"]\s*:\s*([A-Za-z_$][\w$]*)/);
      if (mount) routes.push({ path, line: index + 1, router: 'legacy-route-table', method: 'ALL', route: mount[1], handler: mount[2], review: 'MOUNT_AND_AUTH_NOT_YET_VERIFIED' });
    }
  });
}
const counts = entries => Object.fromEntries([...new Set(entries)].sort().map(key => [key, entries.filter(value => value === key).length]));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'Current worktree source metadata only; no runtime, provider, database, secret, or historical Git-content inspection',
  limitations: ['Regex candidates can be false positives or miss dynamic registrations and queries.', 'Every file is inventoried, not semantically reviewed.', 'Ignored files, dependencies, generated bundles and binary artifacts are excluded.', 'No credentials or matching source snippets are emitted.'],
  summary: { files: files.length, routes: routes.length, candidates: candidates.length, excluded: excluded.length, areas: counts(files.map(file => file.area)), categories: counts(candidates.map(candidate => candidate.category)) },
  files, routes, candidates, excluded,
};
await mkdir(resolve(root, 'docs/hardening'), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
console.log('Source inventory written to docs/hardening/source-surface.json; semantic review remains incomplete.');
