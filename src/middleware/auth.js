'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('../db/prisma');
const logger = require('../logger');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-dev-secret';

/**
 * Verify JWT from HttpOnly cookie and attach user to req.
 * Redirects to login for browser requests; returns 401 for API requests.
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.session_token;
    if (!token) return redirectOrUnauthorized(req, res);

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { roles: { include: { role: true } }, profile: true },
    });

    if (!user || !user.isActive) return redirectOrUnauthorized(req, res);

    req.user = user;
    req.lang = user.profile?.language || 'en';
    next();
  } catch (err) {
    logger.debug('Auth middleware error', { message: err.message });
    redirectOrUnauthorized(req, res);
  }
}

/**
 * Require Administrator role.
 * Must be used after requireAuth.
 */
function requireAdmin(req, res, next) {
  const isAdmin = req.user?.roles?.some((ur) => ur.role.name === 'Administrator');
  if (!isAdmin) {
    const err = new Error('Forbidden');
    err.status = 403;
    return next(err);
  }
  next();
}

/**
 * Optionally attach user to req without blocking unauthenticated access.
 */
async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies?.session_token;
    if (!token) return next();

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { roles: { include: { role: true } }, profile: true },
    });

    if (user && user.isActive) {
      req.user = user;
      req.lang = user.profile?.language || 'en';
    }
  } catch {
    // ignore – unauthenticated
  }
  next();
}

function isAdmin(user) {
  return user?.roles?.some((ur) => ur.role.name === 'Administrator') ?? false;
}

function redirectOrUnauthorized(req, res) {
  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/**
 * Redirect to /change-password if the user must change their password.
 * Must be used after requireAuth.
 */
function enforcePasswordChange(req, res, next) {
  if (req.user?.mustChangePwd && req.user?.isLocal) {
    // Allow the change-password route and logout through
    if (req.path.startsWith('/change-password') || req.path.startsWith('/logout')) {
      return next();
    }
    return res.redirect('/change-password');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth, isAdmin, enforcePasswordChange };
