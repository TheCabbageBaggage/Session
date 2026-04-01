'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const bookingService = require('../../services/bookingService');

// GET /api/bookings – list bookings for calendar rendering
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { startDate, endDate, roomId, userId, status } = req.query;
    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');

    // Non-admins can only fetch their own bookings
    const resolvedUserId = isAdmin
      ? (userId || null)
      : req.user.id;

    const bookings = await bookingService.listBookings({
      startDate: startDate || null,
      endDate: endDate || null,
      roomId: roomId ? Number(roomId) : null,
      userId: resolvedUserId,
      status: status || 'ACTIVE',
    });

    res.json(bookings);
  } catch (err) { next(err); }
});

// PATCH /api/bookings/:id/move – drag-and-drop move
router.patch('/:id/move', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
    const { date, startTime, endTime, roomId } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime and endTime are required' });
    }

    const booking = await bookingService.moveBooking(
      req.params.id, req.user.id, isAdmin, { date, startTime, endTime, roomId }
    );

    res.json(booking);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
