import { createHash } from 'node:crypto';
import { inventoryPool } from '../inventory/db.js';
export async function loginLimit(req, res, next) {
  const username = String(req.body?.username || '').slice(0, 120);
  if (String(req.body?.password || '').length > 1024 || String(req.body?.username || '').length > 120) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid login input.' });
  // Bound both the IP total and IP/account rate; rotating names cannot bypass it.
  const keys = [req.ip, `${req.ip}:${username}`].map(value => createHash('sha256').update(value || '').digest('hex'));
  try {
    for (const [index, key] of keys.entries()) {
      const result = await inventoryPool().query(`INSERT INTO ci_login_rate_limit(key,window_started,attempts) VALUES($1,now(),1)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN ci_login_rate_limit.window_started<now()-interval '1 minute' THEN 1 ELSE ci_login_rate_limit.attempts+1 END,
        window_started=CASE WHEN ci_login_rate_limit.window_started<now()-interval '1 minute' THEN now() ELSE ci_login_rate_limit.window_started END RETURNING attempts`, [key]);
      if (result.rows[0].attempts > (index === 0 ? 30 : 10)) { res.set('Retry-After', '60'); return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many login attempts. Please retry later.' }); }
    }
    // Bounded maintenance, with no tokens, passwords or usernames persisted.
    await inventoryPool().query("DELETE FROM ci_login_rate_limit WHERE key IN (SELECT key FROM ci_login_rate_limit WHERE window_started<now()-interval '1 day' LIMIT 100)");
    res.once('finish', () => {
      if (res.statusCode === 200) void inventoryPool().query('UPDATE ci_login_rate_limit SET attempts=greatest(1,attempts-1) WHERE key=ANY($1::text[])', [keys]).catch(() => {});
    });
    next();
  } catch { res.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable.' }); }
}
