'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../db/prisma');
const logger = require('../logger');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-dev-secret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const COOKIE_NAME = 'session_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours in ms
};

// GET /login
router.get('/login', (req, res) => {
  if (req.cookies?.[COOKIE_NAME]) return res.redirect('/');
  res.render('auth/login', {
    title: req.t('auth.login'),
    next: req.query.next || '/',
    error: null,
  });
});

// POST /login
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
      // Look up local accounts first
      const user = await prisma.user.findUnique({
        where: { username: username.toLowerCase() },
        include: { roles: { include: { role: true } }, profile: true },
      });

      let authenticated = false;

      if (user && user.isLocal && user.passwordHash) {
        authenticated = await bcrypt.compare(password, user.passwordHash);
      } else if (user && !user.isLocal) {
        // Placeholder: LDAP authentication (implemented in M2)
        // For skeleton, AD users cannot log in yet
        logger.info('AD login attempted – LDAP not yet implemented', { username });
        authenticated = false;
      }

      if (!authenticated || !user || !user.isActive) {
        logger.warn('Failed login attempt', { username, ip: req.ip });
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

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          entityType: 'user',
          entityId: user.id,
          ipAddress: req.ip,
        },
      });

      logger.info('User logged in', { userId: user.id, username: user.username });

      res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

      const redirectTo = isValidRedirect(nextUrl) ? nextUrl : '/';
      return res.redirect(redirectTo);
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

// POST /logout
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

// GET /logout (convenience)
router.get('/logout', async (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

function isValidRedirect(url) {
  if (!url) return false;
  // Only allow relative paths to prevent open redirect
  return url.startsWith('/') && !url.startsWith('//');
}

module.exports = router;
