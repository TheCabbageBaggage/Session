'use strict';

const express = require('express');
const router = express.Router();
const bookingService = require('../services/bookingService');
const roomService = require('../services/roomService');

/**
 * GET /public/rooms
 * Unauthenticated room overview for today.
 * Auto-refreshes every 60 seconds (meta refresh).
 * No PII is displayed.
 */
router.get('/rooms', async (req, res, next) => {
  try {
    const [rooms, bookings] = await Promise.all([
      roomService.listRooms(),
      bookingService.getTodayBookings(),
    ]);

    const today = new Date();
    const dateLabel = today.toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Group bookings by roomId for easy template access
    const bookingsByRoom = {};
    bookings.forEach(b => {
      if (!bookingsByRoom[b.roomId]) bookingsByRoom[b.roomId] = [];
      bookingsByRoom[b.roomId].push(b);
    });

    res.render('public/rooms', {
      title: 'Room Overview – Today',
      rooms,
      bookingsByRoom,
      date: dateLabel,
      isoDate: today.toISOString().slice(0, 10),
      refreshInterval: 60,
    });
  } catch (err) { next(err); }
});

module.exports = router;
