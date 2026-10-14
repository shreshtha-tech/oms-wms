import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { inventoryPool } from '../inventory/db.js';
import { createPgCleanupScheduler } from '../reliability/pg-cleanup-scheduler.js';

const scrypt = promisify(scryptCallback);
const lifetimeMs = 8 * 60 * 60 * 1000;
const cookieName = 'dmills_session';
const expiredSessionCleanupSql = `WITH expired AS (
  SELECT token_hash FROM ci_auth_session WHERE expires_at<=now()
  ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
) DELETE FROM ci_auth_session AS sessions USING expired
  WHERE sessions.token_hash=expired.token_hash`;
const scheduleExpiredSessionCleanup = createPgCleanupScheduler({
  sql: expiredSessionCleanupSql,
  batchSize: 1000,
  metric: 'auth_session_cleanup_failures_total',
  event: 'auth_session_cleanup_failed',
});
const permissionNames = new Set([
  'central_inventory.catalog.write',
  'central_inventory.master_data.write',
  'central_inventory.stock_count.write',
  'central_inventory.stock_adjustment.write',
  'central_inventory.alerts.manage',
  'central_inventory.provider_authority.manage',
  'central_inventory.connections.manage',
  'central_inventory.opening_stock.read',
  'central_inventory.opening_stock.stage',
  'central_inventory.opening_stock.request_approval',
  'central_inventory.opening_stock.approve',
  'central_inventory.opening_stock.post',
]);

function cookie(req) {
  const pair = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  return pair ? pair.slice(cookieName.length + 1) : '';
}

function credentialParts(encoded) {
  const parts = String(encoded || '').split(':');
  return parts.length === 2 && parts[0] && /^[a-f0-9]{128}$/i.test(parts[1]) ? parts : null;
}

function parsePermissions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > permissionNames.size || value.some(item => typeof item !== 'string' || !permissionNames.has(item))) return null;
  return [...new Set(value)];
}

function accounts() {
  const rawOperators = process.env.DMILLS_OPERATOR_ACCOUNTS_JSON || '';
  if (rawOperators.length > 65_536) return null;
  let operators = [];
  if (rawOperators) {
    try { operators = JSON.parse(rawOperators); } catch { return null; }
    if (!Array.isArray(operators) || operators.length > 100) return null;
  }
  const rawAdminPermissions = process.env.DMILLS_ADMIN_PERMISSIONS_JSON;
  if (rawAdminPermissions !== undefined && rawAdminPermissions.length > 4096) return null;
  let adminPermissions;
  if (rawAdminPermissions !== undefined) {
    try { adminPermissions = JSON.parse(rawAdminPermissions); } catch { return null; }
  }
  const parsedAdminPermissions = parsePermissions(adminPermissions);
  if (!parsedAdminPermissions) return null;

  const result = [];
  const adminUsername = process.env.DMILLS_ADMIN_USER || '';
  const adminPasswordHash = process.env.DMILLS_ADMIN_PASSWORD_HASH || '';
  if (adminUsername || adminPasswordHash) {
    if (!/^[A-Za-z0-9@._-]{1,120}$/.test(adminUsername) || !credentialParts(adminPasswordHash)) return null;
    result.push({ username: adminUsername, passwordHash: adminPasswordHash, permissions: parsedAdminPermissions });
  }
  const usernames = new Set(result.map(account => account.username));
  for (const operator of operators) {
    if (!operator || typeof operator !== 'object' || Array.isArray(operator) || Object.keys(operator).some(key => !['username','passwordHash','permissions'].includes(key))) return null;
    if (typeof operator.username !== 'string' || !/^[A-Za-z0-9@._-]{1,120}$/.test(operator.username) || usernames.has(operator.username)) return null;
    if (!credentialParts(operator.passwordHash)) return null;
    const permissions = parsePermissions(operator.permissions);
    if (!permissions) return null;
    usernames.add(operator.username);
    result.push({ username: operator.username, passwordHash: operator.passwordHash, permissions });
  }
  return result;
}

function accountFor(username) {
  const configuredAccounts = accounts();
  return configuredAccounts?.find(account => account.username === username) || null;
}

function publicUser(account) {
  return { username: account.username, ...(account.permissions.length ? { permissions: account.permissions } : {}) };
}

function credentialFingerprint(username) {
  const account = accountFor(username);
  return account ? createHash('sha256').update(account.passwordHash).digest('hex') : '';
}

export async function verifyCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const account = accountFor(username);
  if (!account) return false;
  const [salt, expectedHex] = credentialParts(account.passwordHash);
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');
export async function issueSession(res, username, secure = false) {
  const fingerprint = credentialFingerprint(username);
  if (!fingerprint) throw new TypeError('Authenticated account is not configured');
  const token = randomBytes(32).toString('hex');
  await inventoryPool().query('INSERT INTO ci_auth_session(token_hash,username,credential_fingerprint,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[tokenHash(token),username,fingerprint]);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetimeMs / 1000}${secure ? '; Secure' : ''}`);
  scheduleExpiredSessionCleanup();
  return publicUser(accountFor(username));
}

export function currentUser(req) {
  return req.user || null;
}

export async function authenticateSession(req) {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const result=await inventoryPool().query('SELECT username,credential_fingerprint FROM ci_auth_session WHERE token_hash=$1 AND expires_at>now()',[tokenHash(token)]);
  const session=result.rows[0];
  if (!session || !session.credential_fingerprint || session.credential_fingerprint !== credentialFingerprint(session.username)) return null;
  const account=accountFor(session.username);
  return account ? publicUser(account) : null;
}

export async function revokeSession(req, res) {
  const token=cookie(req);
  if(/^[a-f0-9]{64}$/.test(token))await inventoryPool().query('DELETE FROM ci_auth_session WHERE token_hash=$1',[tokenHash(token)]);
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export function authConfigured() { const configuredAccounts=accounts(); return Array.isArray(configuredAccounts) && configuredAccounts.length > 0; }

export function requirePermission(permission) {
  if (!permissionNames.has(permission)) throw new TypeError('Unknown permission');
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!Array.isArray(req.user.permissions) || !req.user.permissions.includes(permission)) return res.status(403).json({ error: 'Permission required.', code: 'PERMISSION_REQUIRED' });
    return next();
  };
}

export function hasPermission(user, permission) {
  return permissionNames.has(permission) && Array.isArray(user?.permissions) && user.permissions.includes(permission);
}
