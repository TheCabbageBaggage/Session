'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/auth');

router.use(requireAuth, requireAdmin);

// GET /admin – admin dashboard (placeholder for M5)
router.get('/', (req, res) => {
  res.render('admin/dashboard', {
    title: req.t('admin.dashboard'),
  });
});

// GET /admin/users – user management (placeholder for M2)
router.get('/users', (req, res) => {
  res.render('admin/users', {
    title: req.t('admin.users'),
    users: [],
  });
});

// GET /admin/rooms – room management (placeholder for M3)
router.get('/rooms', (req, res) => {
  res.render('admin/rooms', {
    title: req.t('admin.rooms'),
    rooms: [],
  });
});

// GET /admin/logs – system logs (placeholder for M2+)
router.get('/logs', (req, res) => {
  res.render('admin/logs', {
    title: req.t('admin.logs'),
  });
});

module.exports = router;
