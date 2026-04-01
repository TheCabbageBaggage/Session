'use strict';

/**
 * User management REST API.
 * All endpoints require authentication; admin-only endpoints additionally require the Administrator role.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const userService = require('../../services/userService');
const prisma = require('../../db/prisma');

// ---------------------------------------------------------------------------
// GET /api/users – paginated user list (admin only)
// ---------------------------------------------------------------------------
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { search = '', roleId, page = 1, pageSize = 25 } = req.query;
    const result = await userService.listUsers({
      search,
      roleId: roleId || null,
      page: Number(page),
      pageSize: Math.min(Number(pageSize), 100),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/users/me – current user's own profile
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  const { passwordHash, ...safeUser } = req.user;
  res.json(safeUser);
});

// ---------------------------------------------------------------------------
// GET /api/users/roles – list all roles
// ---------------------------------------------------------------------------
router.get('/roles/list', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    res.json(roles);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/users/:id – single user (admin only)
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/profile – update profile fields (admin or self)
// ---------------------------------------------------------------------------
router.patch('/:id/profile', requireAuth, async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    const isSelf = req.user.id === targetId;
    const isAdminUser = req.user.roles.some((ur) => ur.role.name === 'Administrator');

    if (!isSelf && !isAdminUser) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { company, costCentre, language } = req.body;
    const profile = await userService.updateProfile(targetId, { company, costCentre, language });
    res.json(profile);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/role – change role (admin only)
// ---------------------------------------------------------------------------
router.post('/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await userService.setRole(req.params.id, req.body.roleId);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/activate|deactivate – admin only
// ---------------------------------------------------------------------------
router.post('/:id/activate',   requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await userService.setActive(req.params.id, true);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/deactivate', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await userService.setActive(req.params.id, false);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
