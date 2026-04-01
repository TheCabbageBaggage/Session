'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Home / dashboard – redirect to booking calendar
router.get('/', requireAuth, (req, res) => {
  res.redirect('/bookings');
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', {
    title: req.t('nav.dashboard'),
  });
});

module.exports = router;
