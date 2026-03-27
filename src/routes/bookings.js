'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const bookingService = require('../services/bookingService');
const recurringService = require('../services/recurringService');
const roomService = require('../services/roomService');
const emailService = require('../services/emailService');
const prisma = require('../db/prisma');
const logger = require('../logger');

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdmin(user) {
  return user.roles && user.roles.some(r => r.role && r.role.name === 'Administrator');
}

/** Resolve user language for email sending. */
async function getUserLanguage(userId) {
  const profile = await prisma.userProfile.findUnique({ where: { userId: Number(userId) } });
  return (profile && profile.language) || 'en';
}

// ---------------------------------------------------------------------------
// Calendar – week view
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    let weekStart;
    if (req.query.date) {
      weekStart = new Date(req.query.date);
    } else {
      weekStart = new Date(today);
    }
    const day  = weekStart.getDay();
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

    const admin  = isAdmin(req.user);
    const userId = admin ? null : req.user.id;

    const [bookings, rooms] = await Promise.all([
      bookingService.listBookings({
        startDate: weekStart.toISOString().slice(0, 10),
        endDate: weekEnd.toISOString().slice(0, 10),
        userId,
      }),
      roomService.listRooms(),
    ]);

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
      isAdmin: admin,
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
      series: null,
      rooms, companies, layouts, profile,
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
// Create booking (single or series)
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
      const { roomId, date, startTime, endTime, attendeeCount, company, costCentre, seatingLayoutId, title, notes } = req.body;

      if (!errors.isEmpty() || startTime >= endTime) {
        const [rooms, companies, layouts, profile] = await Promise.all([
          roomService.listRooms(), roomService.listCompanies(),
          roomService.listSeatingLayouts(), prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
        ]);
        return res.status(400).render('bookings/form', {
          title: req.t('bookings.newBooking'), booking: null, series: null,
          rooms, companies, layouts, profile, prefill: { date, startTime, endTime, roomId },
          error: errors.isEmpty() ? 'End time must be after start time' : errors.array()[0].msg,
        });
      }

      const attendeeEmails    = parseEmails(req.body.attendeeEmails);
      const cateringSelections = parseCatering(req.body);

      const isRecurring = req.body.recurring === 'on';
      const lang = await getUserLanguage(req.user.id);

      if (isRecurring) {
        // Parse recurrence parameters
        const { pattern, intervalValue, monthlyMode, endType } = req.body;
        const weekdays       = [].concat(req.body.weekdays || []).map(Number);
        const endDate        = endType === 'date'  ? req.body.recEndDate  : null;
        const maxOccurrences = endType === 'count' ? Number(req.body.recCount) || null : null;

        const { series, bookings } = await recurringService.createSeries({
          pattern, intervalValue, weekdays, monthlyMode, endDate, maxOccurrences,
          roomId, userId: req.user.id, startDate: date, startTime, endTime,
          attendeeCount, company, costCentre, seatingLayoutId, title, notes,
          attendeeEmails, cateringSelections,
        });

        // Send email for the first occurrence
        if (bookings.length > 0) {
          const firstBooking = await bookingService.getBookingById(bookings[0].id);
          emailService.sendBookingEmail(firstBooking, 'INVITATION', { language: lang, isSeriesOccurrence: true, seriesId: series.id }).catch(e => logger.error('Email error', e));
        }

        logger.info('Recurring series created via UI', { seriesId: series.id, userId: req.user.id });
        return res.redirect(`/bookings?series=${series.id}&success=series_created`);
      }

      // Single booking
      const booking = await bookingService.createBooking({
        roomId, userId: req.user.id, date, startTime, endTime,
        attendeeCount, company, costCentre, seatingLayoutId, title, notes,
        attendeeEmails, cateringSelections,
      });

      // Send invitation email (non-blocking)
      const fullBooking = await bookingService.getBookingById(booking.id);
      emailService.sendBookingEmail(fullBooking, 'INVITATION', { language: lang }).catch(e => logger.error('Email error', e));

      res.redirect(`/bookings/${booking.id}?success=created`);
    } catch (err) {
      if (err.status === 400) {
        const [rooms, companies, layouts, profile] = await Promise.all([
          roomService.listRooms(), roomService.listCompanies(),
          roomService.listSeatingLayouts(), prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
        ]);
        return res.status(400).render('bookings/form', {
          title: req.t('bookings.newBooking'), booking: null, series: null,
          rooms, companies, layouts, profile, prefill: req.body, error: err.message,
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

    const admin = isAdmin(req.user);
    if (!admin && booking.userId !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403 }));
    }

    let series = null;
    if (booking.recurringSeriesId) {
      series = await recurringService.getSeriesById(booking.recurringSeriesId);
    }

    res.render('bookings/detail', {
      title: booking.title || `${req.t('bookings.booking')} #${booking.id}`,
      booking,
      series,
      isAdmin: admin,
      success: req.query.success || null,
      error:   req.query.error   || null,
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

    const admin = isAdmin(req.user);
    if (!admin && booking.userId !== req.user.id) {
      return next(Object.assign(new Error('Forbidden'), { status: 403 }));
    }
    if (booking.status === 'CANCELLED') return res.redirect(`/bookings/${booking.id}`);

    const [rooms, companies, layouts, profile] = await Promise.all([
      roomService.listRooms(), roomService.listCompanies(),
      roomService.listSeatingLayouts(), prisma.userProfile.findUnique({ where: { userId: req.user.id } }),
    ]);

    res.render('bookings/form', {
      title: req.t('bookings.editBooking'),
      booking,
      series: booking.recurringSeriesId
        ? await recurringService.getSeriesById(booking.recurringSeriesId)
        : null,
      rooms, companies, layouts, profile,
      prefill: {
        date: booking.date.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        roomId: booking.roomId,
      },
      error: req.query.error || null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Save booking edit  (single occurrence, or series scope chosen in form)
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
      const admin  = isAdmin(req.user);
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.redirect(`/bookings/${req.params.id}/edit?error=${encodeURIComponent(errors.array()[0].msg)}`);

      const { roomId, date, startTime, endTime, attendeeCount, company, costCentre, seatingLayoutId, title, notes, editScope } = req.body;
      const attendeeEmails    = parseEmails(req.body.attendeeEmails);
      const cateringSelections = parseCatering(req.body);
      const data = { roomId, date, startTime, endTime, attendeeCount, company, costCentre, seatingLayoutId, title, notes, attendeeEmails, cateringSelections };

      const lang = await getUserLanguage(req.user.id);
      const booking = await bookingService.getBookingById(req.params.id);

      if (booking.recurringSeriesId && (editScope === 'series' || editScope === 'future')) {
        const fromDate = editScope === 'future' ? booking.date.toISOString().slice(0, 10) : null;
        const allFrom  = fromDate || await prisma.booking.findFirst({
          where: { recurringSeriesId: booking.recurringSeriesId, status: 'ACTIVE' },
          orderBy: { date: 'asc' },
          select: { date: true },
        }).then(b => b ? b.date.toISOString().slice(0, 10) : date);

        const updatedBookings = await recurringService.editSeriesFrom(
          booking.recurringSeriesId, allFrom, req.user.id, admin, data
        );
        if (updatedBookings.length > 0) {
          const fullFirst = await bookingService.getBookingById(updatedBookings[0].id);
          emailService.sendBookingEmail(fullFirst, 'UPDATE', { language: lang, sequence: 1, isSeriesOccurrence: true, seriesId: booking.recurringSeriesId }).catch(e => logger.error('Email error', e));
        }
        return res.redirect(`/bookings?success=series_updated`);
      }

      // Single occurrence edit (detaches from series if it was part of one)
      if (booking.recurringSeriesId && editScope === 'single') {
        await recurringService.editSingleOccurrence(req.params.id, req.user.id, admin, data);
      } else {
        await bookingService.updateBooking(req.params.id, req.user.id, admin, data);
      }

      const updated = await bookingService.getBookingById(req.params.id);
      emailService.sendBookingEmail(updated, 'UPDATE', { language: lang, sequence: 1 }).catch(e => logger.error('Email error', e));
      res.redirect(`/bookings/${req.params.id}?success=updated`);
    } catch (err) {
      if (err.status === 400 || err.status === 403) return res.redirect(`/bookings/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Cancel booking
// ---------------------------------------------------------------------------
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const admin  = isAdmin(req.user);
    const booking = await bookingService.getBookingById(req.params.id);
    if (!booking) return next(Object.assign(new Error('Booking not found'), { status: 404 }));

    const cancelScope = req.body.cancelScope || 'single';
    const lang        = await getUserLanguage(booking.userId);

    if (booking.recurringSeriesId && cancelScope !== 'single') {
      const fromDate = cancelScope === 'future'
        ? booking.date.toISOString().slice(0, 10)
        : null; // 'all' = cancel everything

      await recurringService.cancelSeries(booking.recurringSeriesId, req.user.id, admin, fromDate);
      // Send cancellation email for the first cancelled booking
      emailService.sendBookingEmail(booking, 'CANCELLATION', { language: lang, sequence: 2, isSeriesOccurrence: true, seriesId: booking.recurringSeriesId }).catch(e => logger.error('Email error', e));
      return res.redirect(`/bookings?success=series_cancelled`);
    }

    await bookingService.cancelBooking(req.params.id, req.user.id, admin);
    emailService.sendBookingEmail(booking, 'CANCELLATION', { language: lang, sequence: 2 }).catch(e => logger.error('Email error', e));
    res.redirect(`/bookings/${req.params.id}?success=cancelled`);
  } catch (err) {
    if (err.status === 400 || err.status === 403) return res.redirect(`/bookings/${req.params.id}?error=${encodeURIComponent(err.message)}`);
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
    const lang = await getUserLanguage(req.user.id);
    const fullBooking = await bookingService.getBookingById(newBooking.id);
    emailService.sendBookingEmail(fullBooking, 'INVITATION', { language: lang }).catch(e => logger.error('Email error', e));
    res.redirect(`/bookings/${newBooking.id}?success=copied`);
  } catch (err) {
    if (err.status === 400 || err.status === 404) return res.redirect(`/bookings/${req.params.id}?error=${encodeURIComponent(err.message)}`);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEmails(raw) {
  return (raw || '').split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
}

function parseCatering(body) {
  const opts = [].concat(body['catering_option'] || []);
  const qtys = [].concat(body['catering_qty']    || []);
  return opts.map((option, i) => ({ option, quantity: Number(qtys[i]) || 1 })).filter(s => s.option);
}

module.exports = router;
