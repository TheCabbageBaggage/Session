'use strict';

const express = require('express');
const router = express.Router();

/**
 * GET /public/rooms
 * Publicly accessible room overview for today – no authentication required.
 * Full implementation in M3.
 */
router.get('/rooms', (req, res) => {
  res.render('public/rooms', {
    title: 'Room Overview – Today',
    rooms: [],
    bookings: [],
    date: new Date().toISOString().slice(0, 10),
    refreshInterval: 60,
    layout: 'layouts/public',
  });
});

module.exports = router;
