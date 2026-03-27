'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const userService = require('../../services/userService');
const adSync = require('../../services/adSync');
const prisma = require('../../db/prisma');
const logger = require('../../logger');

router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const [totalUsers, totalRooms, defaultPwdCount, recentSync] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.room.count({ where: { isActive: true } }),
      userService.countDefaultPasswordAccounts(),
      prisma.adSyncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);

    res.render('admin/dashboard', {
      title: req.t('admin.dashboard'),
      totalUsers,
      totalRooms,
      defaultPwdCount,
      recentSync,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// User Management – list
// ---------------------------------------------------------------------------
router.get('/users', async (req, res, next) => {
  try {
    const { search = '', roleId = '', page = 1 } = req.query;
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    const result = await userService.listUsers({
      search,
      roleId: roleId || null,
      page: Number(page),
      pageSize: 25,
    });

    res.render('admin/users', {
      title: req.t('admin.users'),
      ...result,
      roles,
      search,
      selectedRoleId: roleId,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// User Management – edit form
// ---------------------------------------------------------------------------
router.get('/users/:id/edit', async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    if (!user) return next(Object.assign(new Error('User not found'), { status: 404 }));
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });

    res.render('admin/user-edit', {
      title: `${req.t('admin.editUser')}: ${user.firstName} ${user.lastName}`,
      editUser: user,
      roles,
      error: null,
      success: null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// User Management – save edits (name, email, profile)
// ---------------------------------------------------------------------------
router.post(
  '/users/:id/edit',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('company').trim().optional(),
    body('costCentre').trim().optional(),
    body('language').isIn(['en', 'de']).withMessage('Invalid language'),
  ],
  async (req, res, next) => {
    try {
      const user = await userService.getUserById(req.params.id);
      if (!user) return next(Object.assign(new Error('User not found'), { status: 404 }));
      const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('admin/user-edit', {
          title: `${req.t('admin.editUser')}: ${user.firstName} ${user.lastName}`,
          editUser: user,
          roles,
          error: errors.array()[0].msg,
          success: null,
        });
      }

      const { firstName, lastName, email, company, costCentre, language } = req.body;

      await Promise.all([
        userService.updateUserFields(user.id, { firstName, lastName, email }),
        userService.updateProfile(user.id, { company, costCentre, language }),
      ]);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: user.id,
          details: JSON.stringify({ fields: ['firstName', 'lastName', 'email', 'profile'] }),
          ipAddress: req.ip,
        },
      });

      logger.info('Admin updated user', { adminId: req.user.id, userId: user.id });
      res.redirect(`/admin/users/${user.id}/edit?success=1`);
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// User Management – change role
// ---------------------------------------------------------------------------
router.post('/users/:id/role', async (req, res, next) => {
  try {
    const { roleId } = req.body;
    if (!roleId) return res.redirect(`/admin/users/${req.params.id}/edit`);

    await userService.setRole(req.params.id, roleId);

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_UPDATED',
        entityType: 'user',
        entityId: Number(req.params.id),
        details: JSON.stringify({ change: 'role', roleId }),
        ipAddress: req.ip,
      },
    });

    res.redirect(`/admin/users/${req.params.id}/edit?success=1`);
  } catch (err) {
    if (err.status === 400) {
      const user = await userService.getUserById(req.params.id);
      const roles = await prisma.role.findMany();
      return res.status(400).render('admin/user-edit', {
        title: req.t('admin.editUser'),
        editUser: user,
        roles,
        error: err.message,
        success: null,
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// User Management – deactivate / activate
// ---------------------------------------------------------------------------
router.post('/users/:id/deactivate', async (req, res, next) => {
  try {
    await userService.setActive(req.params.id, false);
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_DEACTIVATED',
        entityType: 'user',
        entityId: Number(req.params.id),
        ipAddress: req.ip,
      },
    });
    res.redirect('/admin/users');
  } catch (err) {
    if (err.status === 400) return res.redirect(`/admin/users/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
    next(err);
  }
});

router.post('/users/:id/activate', async (req, res, next) => {
  try {
    await userService.setActive(req.params.id, true);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// AD Sync – manual trigger
// ---------------------------------------------------------------------------
router.post('/sync/ad', async (req, res, next) => {
  try {
    const result = await adSync.runSync({ triggeredBy: 'MANUAL' });
    logger.info('Manual AD sync triggered', { adminId: req.user.id, result });
    res.redirect('/admin/logs/ad?notice=syncComplete');
  } catch (err) {
    if (err.message.includes('disabled')) {
      return res.redirect('/admin/logs/ad?error=AD+integration+is+disabled');
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
router.get('/logs', (req, res) => res.redirect('/admin/logs/audit'));

router.get('/logs/audit', async (req, res, next) => {
  try {
    const { page = 1 } = req.query;
    const pageSize = 50;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        include: { user: { select: { username: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count(),
    ]);
    res.render('admin/logs', {
      title: req.t('admin.logs'),
      tab: 'audit',
      logs,
      total,
      page: Number(page),
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) { next(err); }
});

router.get('/logs/ad', async (req, res, next) => {
  try {
    const { page = 1 } = req.query;
    const pageSize = 25;
    const [logs, total] = await Promise.all([
      prisma.adSyncLog.findMany({
        orderBy: { startedAt: 'desc' },
        skip: (Number(page) - 1) * pageSize,
        take: pageSize,
      }),
      prisma.adSyncLog.count(),
    ]);
    res.render('admin/logs', {
      title: req.t('admin.logs'),
      tab: 'ad',
      logs,
      total,
      page: Number(page),
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      notice: req.query.notice || null,
      error: req.query.error || null,
    });
  } catch (err) { next(err); }
});

router.get('/logs/email', async (req, res, next) => {
  try {
    const { page = 1 } = req.query;
    const pageSize = 50;
    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        include: { booking: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * pageSize,
        take: pageSize,
      }),
      prisma.emailLog.count(),
    ]);
    res.render('admin/logs', {
      title: req.t('admin.logs'),
      tab: 'email',
      logs,
      total,
      page: Number(page),
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Room management – placeholder (M3)
// ---------------------------------------------------------------------------
router.get('/rooms', (req, res) => {
  res.render('admin/rooms', {
    title: req.t('admin.rooms'),
    rooms: [],
  });
});

module.exports = router;
