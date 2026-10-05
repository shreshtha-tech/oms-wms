import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { inventoryPool } from '../inventory/db.js';

const scrypt = promisify(scryptCallback);
const lifetimeMs = 8 * 60 * 60 * 1000;
const cookieName = 'dmills_session';

function cookie(req) {
  const pair = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  return pair ? pair.slice(cookieName.length + 1) : '';
}

function credentialParts() {
  const parts = String(process.env.DMILLS_ADMIN_PASSWORD_HASH || '').split(':');
  return parts.length === 2 && parts[0] && /^[a-f0-9]{128}$/i.test(parts[1]) ? parts : null;
}

function configured() {
  return Boolean(process.env.DMILLS_ADMIN_USER && credentialParts());
}

export async function verifyCredentials(username, password) {
  if (!configured()) return false;
  if (username !== process.env.DMILLS_ADMIN_USER) return false;
  const [salt, expectedHex] = credentialParts();
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(actual, expected);
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');
const credentialFingerprint = () => createHash('sha256').update(String(process.env.DMILLS_ADMIN_PASSWORD_HASH||'')).digest('hex');

export async function issueSession(res, username, secure = false) {
  const token = randomBytes(32).toString('hex');
  await inventoryPool().query('DELETE FROM ci_auth_session WHERE expires_at<=now()');
  await inventoryPool().query('INSERT INTO ci_auth_session(token_hash,username,credential_fingerprint,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[tokenHash(token),username,credentialFingerprint()]);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetimeMs / 1000}${secure ? '; Secure' : ''}`);
}

export function currentUser(req) {
  return req.user || null;
}

export async function authenticateSession(req) {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const result=await inventoryPool().query('SELECT username FROM ci_auth_session WHERE token_hash=$1 AND expires_at>now() AND username=$2 AND credential_fingerprint=$3',[tokenHash(token),process.env.DMILLS_ADMIN_USER,credentialFingerprint()]);
  return result.rows[0] ? {username:result.rows[0].username} : null;
}

export async function revokeSession(req, res) {
  const token=cookie(req);
  if(/^[a-f0-9]{64}$/.test(token))await inventoryPool().query('DELETE FROM ci_auth_session WHERE token_hash=$1',[tokenHash(token)]);
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export function authConfigured() { return configured(); }
