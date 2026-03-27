'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const bookingService = require('../services/bookingService');
const roomService = require('../services/roomService');
const prisma = require('../db/prisma');
const logger = require('../logger');

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Calendar – week view
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    // Determine the week start (Monday) from query or today
    const today = new Date();
    let weekStart;
    if (req.query.date) {
      weekStart = new Date(req.query.date);
    } else {
      weekStart = new Date(today);
    }
    // Snap to Monday
    const day = weekStart.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    weekStart.setDate(weekStart.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const prevWeek = new Date(weekStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);

    // For non-admins, show only their own bookings; admins see all
    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
    const userId = isAdmin ? null : req.user.id;

    const [bookings, rooms] = await Promise.all([
      bookingService.listBookings({
        startDate: weekStart.toISOString().slice(0, 10),
        endDate: weekEnd.toISOString().slice(0, 10),
        userId,
      }),
      roomService.listRooms(),
    ]);

    // Build week days array
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        isToday: d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10),
      });
    }

    res.render('bookings/index', {
      title: req.t('bookings.calendar'),
      bookings,
      rooms,
      days,
      weekStart: weekStart.toISOString().slice(0, 10),
      prevWeek: prevWeek.toISOString().slice(0, 10),
      nextWeek: nextWeek.toISOString().slice(0, 10),
      today: today.toISOString().slice(0, 10),
      view: req.query.view || 'week',
      isAdmin,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// New booking form
// ---------------------------------------------------------------------------
router.get('/new', async (req, res, next) => {
  try {
    const [rooms, companies, layouts, profile] = await Promise.all([
      roomService.listRooms(),
      roomService.listCompanies(),
      roomService.listSeatingLayouts(),
      prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
    ]);

    res.render('bookings/form', {
      title: req.t('bookings.newBooking'),
      booking: null,
      rooms,
      companies,
      layouts,
      profile,
      prefill: {
        date: req.query.date || '',
        startTime: req.query.startTime || '',
        endTime: req.query.endTime || '',
        roomId: req.query.roomId || '',
      },
      error: null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Create booking
// ---------------------------------------------------------------------------
router.post(
  '/',
  [
    body('roomId').notEmpty().withMessage('Room is required'),
    body('date').isISO8601().withMessage('Valid date is required'),
    body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid start time is required'),
    body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid end time is required'),
    body('attendeeCount').isInt({ min: 1 }).withMessage('Attendee count must be at least 1'),
    body('company').trim().notEmpty().withMessage('Company is required'),
    body('costCentre').trim().notEmpty().withMessage('Cost centre is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);

      const {
        roomId, date, startTime, endTime, attendeeCount,
        company, costCentre, seatingLayoutId, title, notes,
      } = req.body;

      // Validate times
      if (!errors.isEmpty() || startTime >= endTime) {
        const [rooms, companies, layouts, profile] = await Promise.all([
          roomService.listRooms(),
          roomService.listCompanies(),
          roomService.listSeatingLayouts(),
          prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
        ]);
        return res.status(400).render('bookings/form', {
          title: req.t('bookings.newBooking'),
          booking: null,
          rooms, companies, layouts, profile,
          prefill: { date, startTime, endTime, roomId },
          error: errors.isEmpty() ? 'End time must be after start time' : errors.array()[0].msg,
        });
      }

      // Parse attendee emails
      const attendeeEmails = (req.body.attendeeEmails || '')
        .split(/[\n,;]+/)
        .map(e => e.trim())
        .filter(Boolean);

      // Parse catering selections
      const cateringOptions = [].concat(req.body['catering_option'] || []);
      const cateringQuantities = [].concat(req.body['catering_qty'] || []);
      const cateringSelections = cateringOptions
        .map((option, i) => ({ option, quantity: Number(cateringQuantities[i]) || 1 }))
        .filter(s => s.option);

      const booking = await bookingService.createBooking({
        roomId, userId: req.user.id, date, startTime, endTime,
        attendeeCount, company, costCentre, seatingLayoutId,
        title, notes, attendeeEmails, cateringSelections,
      });

      logger.info('Booking created via UI', { bookingId: booking.id, userId: req.user.id });
      res.redirect(`/bookings/${booking.id}?success=created`);
    } catch (err) {
      if (err.status === 400) {
        const [rooms, companies, layouts, profile] = await Promise.all([
          roomService.listRooms(),
          roomService.listCompanies(),
          roomService.listSeatingLayouts(),
          prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
        ]);
        return res.status(400).render('bookings/form', {
          title: req.t('bookings.newBooking'),
          booking: null,
          rooms, companies, layouts, profile,
          prefill: req.body,
          error: err.message,
        });
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Booking detail
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id);
    if (!booking) return next(Object.assign(new Error('Booking not found'), { status: 404 }));

    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
    if (!isAdmin && booking.userId !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403 }));
    }

    res.render('bookings/detail', {
      title: booking.title || `${req.t('bookings.booking')} #${booking.id}`,
      booking,
      isAdmin,
      success: req.query.success || null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Edit booking form
// ---------------------------------------------------------------------------
router.get('/:id/edit', async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id);
    if (!booking) return next(Object.assign(new Error('Booking not found'), { status: 404 }));

    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
    if (!isAdmin && booking.userId !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403 }));
    }
    if (booking.status === 'CANCELLED') {
      return res.redirect(`/bookings/${booking.id}`);
    }

    const [rooms, companies, layouts, profile] = await Promise.all([
      roomService.listRooms(),
      roomService.listCompanies(),
      roomService.listSeatingLayouts(),
      prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
    ]);

    res.render('bookings/form', {
      title: req.t('bookings.editBooking'),
      booking,
      rooms, companies, layouts, profile,
      prefill: {
        date: booking.date.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        roomId: booking.roomId,
      },
      error: null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Save booking edit
// ---------------------------------------------------------------------------
router.post(
  '/:id/edit',
  [
    body('date').isISO8601().withMessage('Valid date is required'),
    body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid start time is required'),
    body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid end time is required'),
    body('attendeeCount').isInt({ min: 1 }).withMessage('Attendee count must be at least 1'),
  ],
  async (req, res, next) => {
    try {
      const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        return res.redirect(`/bookings/${req.params.id}/edit?error=${encodeURIComponent(errors.array()[0].msg)}`);
      }

      const {
        roomId, date, startTime, endTime, attendeeCount,
        company, costCentre, seatingLayoutId, title, notes,
      } = req.body;

      const attendeeEmails = (req.body.attendeeEmails || '')
        .split(/[\n,;]+/)
        .map(e => e.trim())
        .filter(Boolean);

      const cateringOptions = [].concat(req.body['catering_option'] || []);
      const cateringQuantities = [].concat(req.body['catering_qty'] || []);
      const cateringSelections = cateringOptions
        .map((option, i) => ({ option, quantity: Number(cateringQuantities[i]) || 1 }))
        .filter(s => s.option);

      await bookingService.updateBooking(req.params.id, req.user.id, isAdmin, {
        roomId, date, startTime, endTime, attendeeCount,
        company, costCentre, seatingLayoutId, title, notes,
        attendeeEmails, cateringSelections,
      });

      res.redirect(`/bookings/${req.params.id}?success=updated`);
    } catch (err) {
      if (err.status === 400 || err.status === 403) {
        return res.redirect(`/bookings/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
      }
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Cancel booking
// ---------------------------------------------------------------------------
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const isAdmin = req.user.roles && req.user.roles.some(r => r.role && r.role.name === 'Administrator');
    await bookingService.cancelBooking(req.params.id, req.user.id, isAdmin);
    res.redirect(`/bookings/${req.params.id}?success=cancelled`);
  } catch (err) {
    if (err.status === 400 || err.status === 403) {
      return res.redirect(`/bookings/${req.params.id}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Copy booking
// ---------------------------------------------------------------------------
router.post('/:id/copy', async (req, res, next) => {
  try {
    const { date, startTime, endTime, roomId } = req.body;
    const newBooking = await bookingService.copyBooking(req.params.id, req.user.id, { date, startTime, endTime, roomId });
    res.redirect(`/bookings/${newBooking.id}?success=copied`);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.redirect(`/bookings/${req.params.id}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

module.exports = router;
