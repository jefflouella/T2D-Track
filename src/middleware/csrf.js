import { randomToken, hashToken, timingSafeEqualString } from '../crypto.js';
import { isProd } from '../config.js';
import { HttpError } from '../util.js';

const COOKIE = isProd ? '__Host-t2d.csrf' : 't2d.csrf';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  };
}

export function csrfTokenHandler(req, res) {
  const raw = randomToken(32);
  res.cookie(COOKIE, hashToken(raw), cookieOptions());
  // Client receives the raw token; cookie stores the hash (like sessions).
  res.json({ csrfToken: raw });
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header =
    req.headers['x-csrf-token'] || req.body?._csrf || req.query?._csrf || '';
  const cookieHash = req.cookies?.[COOKIE];
  if (!header || !cookieHash) {
    return next(new HttpError(403, 'Invalid CSRF token'));
  }
  const expected = hashToken(String(header));
  if (!timingSafeEqualString(expected, String(cookieHash))) {
    return next(new HttpError(403, 'Invalid CSRF token'));
  }
  return next();
}

export function generateCsrfToken(req, res) {
  const raw = randomToken(32);
  res.cookie(COOKIE, hashToken(raw), cookieOptions());
  return raw;
}
