import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const SESSION_MS = 12 * 60 * 60 * 1000;

export function hashAdminPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyAdminPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const next = scryptSync(String(password), salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function sameText(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function createAdminAuth({
  username = 'admin',
  password = '',
  passwordHash = '',
  now = () => Date.now(),
  secureCookie = false
} = {}) {
  const storedHash = password ? hashAdminPassword(password) : (passwordHash || '');
  const expectedUsername = String(username || 'admin');
  const sessions = new Map();
  const failures = new Map();

  function configured() {
    return Boolean(storedHash);
  }

  function pruneFailures(at) {
    for (const [ip, bucket] of failures) {
      if (at - bucket.started > WINDOW_MS) failures.delete(ip);
    }
  }

  function locked(ip, at) {
    pruneFailures(at);
    const bucket = failures.get(ip);
    return Boolean(bucket && bucket.count >= MAX_FAILS && at - bucket.started < WINDOW_MS);
  }

  function fail(ip, at) {
    const bucket = failures.get(ip);
    if (!bucket || at - bucket.started > WINDOW_MS) failures.set(ip, { count: 1, started: at });
    else bucket.count += 1;
  }

  function cookie(token) {
    const parts = [
      `nearer_admin=${encodeURIComponent(token)}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${SESSION_MS / 1000}`
    ];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  function clearedCookie() {
    const parts = ['nearer_admin=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  return {
    configured,
    cookie,
    clearedCookie,
    login(ip, usernameValue, passwordValue, at = now()) {
      if (!configured()) return { error: 'admin_disabled', status: 503 };
      if (locked(ip, at)) return { error: 'rate_limited', status: 429 };
      const usernameOk = sameText(usernameValue || '', expectedUsername);
      const passwordOk = verifyAdminPassword(passwordValue, storedHash);
      if (!usernameOk || !passwordOk) {
        fail(ip, at);
        return { error: 'unauthorized', status: 401 };
      }
      failures.delete(ip);
      const token = randomBytes(32).toString('base64url');
      const csrf = randomBytes(24).toString('base64url');
      sessions.set(token, { csrf, expires: at + SESSION_MS });
      return { token, csrf, status: 200 };
    },
    sessionFromCookie(header, at = now()) {
      const match = String(header || '').match(/(?:^|;\s*)nearer_admin=([^;]+)/);
      if (!match) return null;
      let token = '';
      try { token = decodeURIComponent(match[1]); } catch { return null; }
      const session = sessions.get(token);
      if (!session || session.expires <= at) {
        sessions.delete(token);
        return null;
      }
      return { token, csrf: session.csrf };
    },
    logout(token) {
      sessions.delete(token);
    },
    csrfOk(session, header) {
      if (!session?.csrf || !header) return false;
      const a = Buffer.from(String(session.csrf));
      const b = Buffer.from(String(header));
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    }
  };
}
