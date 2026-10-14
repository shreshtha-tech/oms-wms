// Offline lexical evidence only: no server import, environment loading or DB access.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await readFile(resolve(root, 'server.js'), 'utf8');
const imports = new Map([...server.matchAll(/^import\s+([\w$]+)\s+from\s+['"]([^'"]+)['"]/gm)]
  .map(match => [match[1], match[2]]));
const surface = JSON.parse(await readFile(resolve(root, 'docs/hardening/source-surface.json'), 'utf8'));
const evidence = [];
for (const mount of surface.routes.filter(route => route.router === 'legacy-route-table')) {
  const imported = imports.get(mount.handler);
  if (!imported?.startsWith('./api/')) throw new Error('Legacy handler import cannot be resolved');
  const sourcePath = imported.slice(2);
  const source = await readFile(resolve(root, sourcePath), 'utf8');
  const lines = source.split('\n');
  const references = (pattern, category) => lines.flatMap((line, index) => {
    const matches = [...line.matchAll(pattern)];
    return matches.map(match => ({ category, line: index + 1, name: match[1] }));
  });
  const storage = references(/\b(?:find|findOne|insert|update|remove|removeIfPresent|updateIfRevision|ensureIndex)\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]/g, 'mongo-helper-collection');
  const direct = references(/\.collection\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]/g, 'direct-mongo-collection');
  const methods = references(/req\.method\s*===?\s*['"]([A-Z]+)['"]/g, 'method-branch');
  const permissions = references(/(?:requirePermission|hasPermission)\s*\(\s*(?:req\.user\s*,\s*)?['"]([a-zA-Z0-9_.-]+)['"]/g, 'permission-literal');
  const importsLocal = references(/\bfrom\s+['"](\.[^'"]+)['"]/g, 'local-import').map(item => ({ ...item, name: resolve(root, dirname(sourcePath), item.name) })).map(item => ({ ...item, name: item.name.startsWith(root) ? item.name.slice(root.length) : item.name }));
  evidence.push({
    route: mount.route, mountLine: mount.line, handler: mount.handler, source: sourcePath,
    authentication: 'SERVER_SHARED_SESSION_MIDDLEWARE',
    authorization: 'NOT_VERIFIED', tenantOwnership: 'NOT_VERIFIED', objectOwnership: 'NOT_VERIFIED',
    declaredMethodBranches: [...new Set(methods.map(item => item.name))],
    storage, direct, permissions, localImports: importsLocal,
    candidateReferences: surface.candidates.filter(item => item.path === sourcePath),
    tests: 'NOT_RUN_FOR_THIS_MATRIX',
  });
}
const columns = ['route', 'source', 'declared_methods', 'authentication', 'authorization', 'tenant_ownership', 'object_ownership', 'collection_candidates', 'permission_literal_candidates', 'verification'];
const cell = value => `"${String(value).replaceAll('"', '""')}"`;
const csv = [columns, ...evidence.map(row => [row.route, row.source, row.declaredMethodBranches.join('|'), row.authentication, row.authorization, row.tenantOwnership, row.objectOwnership, [...new Set([...row.storage, ...row.direct].map(item => item.name))].join('|'), [...new Set(row.permissions.map(item => item.name))].join('|'), row.tests])].map(row => row.map(cell).join(',')).join('\n');
await mkdir(resolve(root, 'docs/hardening'), { recursive: true });
await writeFile(resolve(root, 'docs/hardening/legacy-api-matrix.csv'), `${csv}\n`);
await writeFile(resolve(root, 'docs/hardening/legacy-api-evidence.json'), `${JSON.stringify({
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  limitations: ['Lexical direct-handler traces only; imports and dynamic helper/collection names need semantic review.', 'Method branches are candidates, not proof of supported method validation.', 'A permission literal does not prove authorization; absence does not prove absence of a delegated guard.', 'Shared session middleware traced manually in server.js before the route table; no HTTP acceptance in this run.'],
  routes: evidence,
}, null, 2)}\n`);
const inventoryPrefix = '/api/inventory-sync';
const mounts = new Map([
  ['centralInventoryApi', `${inventoryPrefix}/central`],
  ['inventoryFilesApi', `${inventoryPrefix}/central`],
  ['sellerConnectionsApi', `${inventoryPrefix}/connections`],
  ['sellerOAuthApi', `${inventoryPrefix}/connections`],
  ['inventoryPublic', inventoryPrefix], ['inventoryPrivate', inventoryPrefix],
  ['salesProgramsApi', `${inventoryPrefix}/connections/programs`],
  ['tallyPrivate', `${inventoryPrefix}/connections/agent`], ['tallyPublic', `${inventoryPrefix}/connections/agent`],
  ['whatsappPublic', `${inventoryPrefix}/whatsapp`],
]);
const publicRouters = new Set(['sellerOAuthApi', 'inventoryPublic', 'tallyPublic', 'whatsappPublic']);
const modern = surface.routes.filter(item => item.path.startsWith('inventory/') || (item.path === 'server.js' && item.router === 'app')).map(item => {
  let prefix = mounts.get(item.router);
  if (item.router === 'router' && item.path === 'inventory/unified-orders.js') prefix = `${inventoryPrefix}/unified`;
  if (item.router === 'router' && item.path === 'inventory/alert-admin.js') prefix = `${inventoryPrefix}/unified/alert-admin`;
  if (item.router === 'app') prefix = '';
  if (prefix === undefined) throw new Error('Unresolved current router mount; review before generating');
  const publicRoute = publicRouters.has(item.router) || (item.router === 'app' && item.route.startsWith('/api/auth/'));
  return { ...item, fullRoute: `${prefix}${item.route === '/' ? '' : item.route}`, authentication: publicRoute ? 'ROUTE_SPECIFIC_REVIEW_REQUIRED' : 'SERVER_SHARED_SESSION_MIDDLEWARE', authorization: 'NOT_VERIFIED', tenantOwnership: 'NOT_VERIFIED', objectOwnership: 'NOT_VERIFIED', verification: 'SOURCE_MOUNT_TRACE_ONLY' };
});
await writeFile(resolve(root, 'docs/hardening/modern-api-evidence.json'), `${JSON.stringify({schemaVersion: 1, generatedAt: new Date().toISOString(), limitations: ['Manually traced current Express mounts; no HTTP acceptance.', 'Array/regex route registrations and middleware branches are outside this lexical list.', 'Public routes use distinct signatures/state/token/session rules; no generic authentication verdict is asserted.', 'Private route authorization, input bounds and foreign object ownership remain unverified.'], routes: modern}, null, 2)}\n`);
console.log(JSON.stringify({ legacyMounts: evidence.length, distinctHandlers: new Set(evidence.map(row => row.source)).size, collectionReferences: evidence.reduce((sum, row) => sum + row.storage.length + row.direct.length, 0), modernRouteCandidates: modern.length }));
