'use strict';

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIE = 'session_token';
const CSRF_COOKIE = 'csrf_token';

function getHost(req) {
  const forwarded = req.get('x-forwarded-host');
  const host = forwarded || req.get('host') || '';
  return host.toLowerCase();
}

function isSameHost(urlString, host) {
  try {
    return new URL(urlString).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function secureEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function attachCsrfToken(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }
  req.csrfToken = () => token;
  res.locals.csrfToken = token;
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // CSRF concerns apply to authenticated, cookie-backed sessions.
  if (!req.cookies?.[SESSION_COOKIE]) return next();

  const host = getHost(req);
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (origin && isSameHost(origin, host)) return next();
  if (!origin && referer && isSameHost(referer, host)) return next();

  const expected = req.cookies?.[CSRF_COOKIE];
  const provided = req.get('x-csrf-token') || req.body?._csrf;
  if (expected && provided && secureEqual(expected, provided)) return next();

  const err = new Error('CSRF validation failed');
  err.status = 403;
  return next(err);
}

module.exports = { attachCsrfToken, requireCsrf };
