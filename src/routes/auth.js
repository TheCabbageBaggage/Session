'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../db/prisma');
const ldapService = require('../services/ldap');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');
const logger = require('../logger');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-dev-secret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const COOKIE_NAME = 'session_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.cookies?.[COOKIE_NAME]) return res.redirect('/');
  res.render('auth/login', {
    title: req.t('auth.login'),
    next: req.query.next || '/',
    error: null,
  });
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('auth/login', {
        title: req.t('auth.login'),
        next: req.body.next || '/',
        error: errors.array()[0].msg,
      });
    }

    const { username, password, next: nextUrl } = req.body;

    try {
      let user = await prisma.user.findUnique({
        where: { username: username.toLowerCase().trim() },
        include: { roles: { include: { role: true } }, profile: true },
      });

      let authenticated = false;

      if (user && user.isLocal && user.passwordHash) {
        // Local account – verify bcrypt hash
        authenticated = await bcrypt.compare(password, user.passwordHash);
      } else {
        // AD account – attempt LDAP bind
        const adUser = await ldapService.authenticateUser(username.trim(), password);

        if (adUser) {
          // Ensure the user exists in our DB (they may have been synced or may be new)
          if (!user) {
            // Auto-provision: user authenticated via AD but not yet in DB
            // Find/create the Employee role
            const employeeRole = await prisma.role.findFirst({ where: { name: 'Employee' } });
            user = await prisma.user.create({
              data: {
                username: adUser.username.toLowerCase(),
                firstName: adUser.firstName,
                lastName: adUser.lastName,
                email: adUser.email,
                isLocal: false,
                isActive: true,
                adObjectGuid: adUser.objectGuid,
                profile: { create: { language: 'en' } },
                roles: employeeRole ? { create: { roleId: employeeRole.id } } : undefined,
              },
              include: { roles: { include: { role: true } }, profile: true },
            });
            logger.info('Auto-provisioned AD user on first login', { username: user.username });
          } else {
            // Update name/email from AD in case they changed
            await prisma.user.update({
              where: { id: user.id },
              data: {
                firstName: adUser.firstName || user.firstName,
                lastName: adUser.lastName || user.lastName,
                email: adUser.email || user.email,
                isActive: true,
              },
            });
            user = await prisma.user.findUnique({
              where: { id: user.id },
              include: { roles: { include: { role: true } }, profile: true },
            });
          }
          authenticated = true;
        }
      }

      if (!authenticated || !user || !user.isActive) {
        logger.warn('Failed login attempt', { username, ip: req.ip });
        await prisma.auditLog.create({
          data: {
            action: 'LOGIN',
            entityType: 'user',
            details: JSON.stringify({ outcome: 'failed', username }),
            ipAddress: req.ip,
          },
        }).catch(() => {});
        return res.status(401).render('auth/login', {
          title: req.t('auth.login'),
          next: nextUrl || '/',
          error: req.t('auth.invalidCredentials'),
        });
      }

      // Issue JWT
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

      // Update last login
      await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          entityType: 'user',
          entityId: user.id,
          details: JSON.stringify({ outcome: 'success', accountType: user.isLocal ? 'local' : 'ad' }),
          ipAddress: req.ip,
        },
      });

      logger.info('User logged in', { userId: user.id, username: user.username });

      // Force password change if required
      if (user.mustChangePwd && user.isLocal) {
        return res.redirect('/change-password');
      }

      return res.redirect(isValidRedirect(nextUrl) ? nextUrl : '/');
    } catch (err) {
      logger.error('Login error', { message: err.message, stack: err.stack });
      return res.status(500).render('auth/login', {
        title: req.t('auth.login'),
        next: nextUrl || '/',
        error: req.t('errors.unexpected'),
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /change-password
// Accessible only while logged in with mustChangePwd = true
// ---------------------------------------------------------------------------
router.get('/change-password', requireAuth, (req, res) => {
  res.render('auth/change-password', {
    title: req.t('auth.changePassword'),
    error: null,
    success: null,
    forced: req.user.mustChangePwd,
  });
});

// ---------------------------------------------------------------------------
// POST /change-password
// ---------------------------------------------------------------------------
router.post(
  '/change-password',
  requireAuth,
  [
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('confirmPassword')
      .custom((val, { req: r }) => val === r.body.newPassword)
      .withMessage('Passwords do not match'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('auth/change-password', {
        title: req.t('auth.changePassword'),
        error: errors.array()[0].msg,
        success: null,
        forced: req.user.mustChangePwd,
      });
    }

    try {
      if (!req.user.isLocal) {
        return res.status(400).render('auth/change-password', {
          title: req.t('auth.changePassword'),
          error: req.t('auth.adPasswordChange'),
          success: null,
          forced: false,
        });
      }

      await userService.changePassword(req.user.id, req.body.newPassword);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: req.user.id,
          details: JSON.stringify({ change: 'password' }),
          ipAddress: req.ip,
        },
      });

      logger.info('User changed password', { userId: req.user.id });
      return res.redirect('/?notice=passwordChanged');
    } catch (err) {
      return res.status(400).render('auth/change-password', {
        title: req.t('auth.changePassword'),
        error: err.message,
        success: null,
        forced: req.user.mustChangePwd,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------
router.post('/logout', async (req, res) => {
  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'LOGOUT',
        entityType: 'user',
        entityId: req.user.id,
        ipAddress: req.ip,
      },
    }).catch(() => {});
    logger.info('User logged out', { userId: req.user.id });
  }
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

function isValidRedirect(url) {
  if (!url) return false;
  return url.startsWith('/') && !url.startsWith('//');
}

module.exports = router;
