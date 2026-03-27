'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// All booking routes require authentication
router.use(requireAuth);

// GET /bookings – booking calendar (placeholder for M3)
router.get('/', (req, res) => {
  res.render('bookings/index', {
    title: req.t('nav.bookings'),
  });
});

// GET /bookings/new – new booking form (placeholder for M3)
router.get('/new', (req, res) => {
  res.render('bookings/form', {
    title: req.t('bookings.newBooking'),
    booking: null,
  });
});

module.exports = router;
