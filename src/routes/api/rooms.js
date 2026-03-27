'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const bookingService = require('../../services/bookingService');
const roomService = require('../../services/roomService');

// GET /api/rooms – list active rooms
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { type, minCapacity } = req.query;
    const rooms = await roomService.listRooms({ type: type || null });
    const filtered = minCapacity
      ? rooms.filter(r => r.capacity >= Number(minCapacity))
      : rooms;
    res.json(filtered);
  } catch (err) { next(err); }
});

// GET /api/rooms/available – rooms available for a given time slot
router.get('/available', requireAuth, async (req, res, next) => {
  try {
    const { date, startTime, endTime, type, minCapacity, excludeBookingId } = req.query;
    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime and endTime are required' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }

    const cateringOptions = req.query.cateringOptions
      ? [].concat(req.query.cateringOptions)
      : [];

    const rooms = await bookingService.getAvailableRooms({
      date, startTime, endTime,
      type: type || null,
      minCapacity: minCapacity ? Number(minCapacity) : null,
      cateringOptions,
    });

    // If editing, re-include the current booking's room even if it would conflict
    if (excludeBookingId) {
      const allRooms = await roomService.listRooms();
      const availableIds = new Set(rooms.map(r => r.id));
      // Add any rooms not already in the available set that this booking uses
      allRooms.forEach(r => {
        if (!availableIds.has(r.id)) rooms.push({ ...r, _currentBookingRoom: true });
      });
    }

    res.json(rooms);
  } catch (err) { next(err); }
});

module.exports = router;
