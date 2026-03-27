'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const userService = require('../../services/userService');
const roomService = require('../../services/roomService');
const adSync = require('../../services/adSync');
const prisma = require('../../db/prisma');
const logger = require('../../logger');

router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Multer – room image uploads
// ---------------------------------------------------------------------------
const uploadDir = path.join(__dirname, '../../../public/uploads/rooms');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `room-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF or WebP images are allowed'), false);
  },
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [totalUsers, totalRooms, todayBookings, defaultPwdCount, recentSync] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.room.count({ where: { isActive: true } }),
      prisma.booking.count({ where: { date: today, status: 'ACTIVE' } }),
      userService.countDefaultPasswordAccounts(),
      prisma.adSyncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);

    res.render('admin/dashboard', {
      title: req.t('admin.dashboard'),
      totalUsers,
      totalRooms,
      todayBookings,
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
      error: req.query.error || null,
      success: req.query.success ? req.t('admin.userSaved') : null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// User Management – save edits
// ---------------------------------------------------------------------------
router.post(
  '/users/:id/edit',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
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
// Room Management
// ---------------------------------------------------------------------------

router.get('/rooms', async (req, res, next) => {
  try {
    const rooms = await roomService.listRooms({ includeInactive: true });
    res.render('admin/rooms', {
      title: req.t('admin.rooms'),
      rooms,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) { next(err); }
});

router.get('/rooms/new', async (req, res, next) => {
  try {
    const layouts = await roomService.listSeatingLayouts({ includeInactive: false });
    res.render('admin/room-form', {
      title: req.t('admin.addRoom'),
      room: null,
      layouts,
      error: null,
    });
  } catch (err) { next(err); }
});

router.post('/rooms/new', upload.single('image'), async (req, res, next) => {
  try {
    const { name, description, location, capacity, type, exchangeMailbox } = req.body;
    const cateringOptions = [].concat(req.body.cateringOptions || []).filter(Boolean);
    const seatingLayoutIds = [].concat(req.body.seatingLayoutIds || []).filter(Boolean);
    const imagePath = req.file ? `/uploads/rooms/${req.file.filename}` : null;

    await roomService.createRoom({ name, description, location, capacity, type, imagePath, exchangeMailbox, cateringOptions, seatingLayoutIds });
    logger.info('Room created', { adminId: req.user.id, name });
    res.redirect('/admin/rooms?success=created');
  } catch (err) {
    const layouts = await roomService.listSeatingLayouts({ includeInactive: false });
    res.status(400).render('admin/room-form', { title: req.t('admin.addRoom'), room: null, layouts, error: err.message });
  }
});

router.get('/rooms/:id/edit', async (req, res, next) => {
  try {
    const [room, layouts] = await Promise.all([
      roomService.getRoomById(req.params.id),
      roomService.listSeatingLayouts({ includeInactive: false }),
    ]);
    if (!room) return next(Object.assign(new Error('Room not found'), { status: 404 }));
    res.render('admin/room-form', { title: req.t('admin.editRoom'), room, layouts, error: null });
  } catch (err) { next(err); }
});

router.post('/rooms/:id/edit', upload.single('image'), async (req, res, next) => {
  try {
    const { name, description, location, capacity, type, exchangeMailbox, isActive } = req.body;
    const cateringOptions = [].concat(req.body.cateringOptions || []).filter(Boolean);
    const seatingLayoutIds = [].concat(req.body.seatingLayoutIds || []).filter(Boolean);

    const existing = await roomService.getRoomById(req.params.id);
    if (!existing) return next(Object.assign(new Error('Room not found'), { status: 404 }));
    const imagePath = req.file ? `/uploads/rooms/${req.file.filename}` : existing.imagePath;

    await roomService.updateRoom(req.params.id, {
      name, description, location, capacity, type, imagePath, exchangeMailbox,
      isActive: isActive !== undefined ? isActive === 'true' : existing.isActive,
      cateringOptions, seatingLayoutIds,
    });
    logger.info('Room updated', { adminId: req.user.id, roomId: req.params.id });
    res.redirect('/admin/rooms?success=updated');
  } catch (err) {
    const layouts = await roomService.listSeatingLayouts({ includeInactive: false });
    res.status(400).render('admin/room-form', {
      title: req.t('admin.editRoom'),
      room: { id: req.params.id, ...req.body },
      layouts,
      error: err.message,
    });
  }
});

router.post('/rooms/:id/delete', async (req, res, next) => {
  try {
    await roomService.deleteRoom(req.params.id);
    logger.info('Room deactivated', { adminId: req.user.id, roomId: req.params.id });
    res.redirect('/admin/rooms?success=deleted');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Company Management
// ---------------------------------------------------------------------------

router.get('/companies', async (req, res, next) => {
  try {
    const companies = await roomService.listCompanies({ includeInactive: true });
    res.render('admin/companies', {
      title: req.t('admin.companies'),
      companies,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) { next(err); }
});

router.post('/companies/new', [
  body('name').trim().notEmpty().withMessage('Company name is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect(`/admin/companies?error=${encodeURIComponent(errors.array()[0].msg)}`);

    const { name, isDefault } = req.body;
    await roomService.createCompany({ name, isDefault: isDefault === 'on' });
    res.redirect('/admin/companies?success=created');
  } catch (err) { next(err); }
});

router.post('/companies/:id/edit', [
  body('name').trim().notEmpty().withMessage('Company name is required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect(`/admin/companies?error=${encodeURIComponent(errors.array()[0].msg)}`);

    const { name, isDefault, isActive } = req.body;
    await roomService.updateCompany(req.params.id, {
      name,
      isDefault: isDefault === 'on',
      isActive: isActive !== 'false',
    });
    res.redirect('/admin/companies?success=updated');
  } catch (err) { next(err); }
});

router.post('/companies/:id/delete', async (req, res, next) => {
  try {
    await roomService.deleteCompany(req.params.id);
    res.redirect('/admin/companies?success=deleted');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Seating Layout Management
// ---------------------------------------------------------------------------

router.get('/seating-layouts', async (req, res, next) => {
  try {
    const layouts = await roomService.listSeatingLayouts({ includeInactive: true });
    res.render('admin/seating-layouts', {
      title: req.t('admin.seatingLayouts'),
      layouts,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) { next(err); }
});

const layoutUploadDir = path.join(__dirname, '../../../public/uploads/layouts');
const layoutStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(layoutUploadDir, { recursive: true });
    cb(null, layoutUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `layout-${Date.now()}${ext}`);
  },
});
const uploadLayout = multer({ storage: layoutStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/seating-layouts/new', uploadLayout.single('image'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.redirect('/admin/seating-layouts?error=Name+is+required');
    const imagePath = req.file ? `/uploads/layouts/${req.file.filename}` : null;
    await roomService.createSeatingLayout({ name, description, imagePath });
    res.redirect('/admin/seating-layouts?success=created');
  } catch (err) { next(err); }
});

router.post('/seating-layouts/:id/edit', uploadLayout.single('image'), async (req, res, next) => {
  try {
    const { name, description, isActive } = req.body;
    if (!name) return res.redirect('/admin/seating-layouts?error=Name+is+required');
    const existing = await roomService.getSeatingLayoutById(req.params.id);
    const imagePath = req.file ? `/uploads/layouts/${req.file.filename}` : (existing ? existing.imagePath : null);
    await roomService.updateSeatingLayout(req.params.id, {
      name, description, imagePath,
      isActive: isActive !== 'false',
    });
    res.redirect('/admin/seating-layouts?success=updated');
  } catch (err) { next(err); }
});

router.post('/seating-layouts/:id/delete', async (req, res, next) => {
  try {
    await roomService.deleteSeatingLayout(req.params.id);
    res.redirect('/admin/seating-layouts?success=deleted');
  } catch (err) { next(err); }
});

module.exports = router;
