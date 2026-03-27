'use strict';

/**
 * Recurring series service.
 *
 * Patterns:
 *   DAILY   – every N days
 *   WEEKLY  – every N weeks on selected weekdays (JSON array [0-6], 0=Sun)
 *   MONTHLY – every N months on the same day of month ("SAME_DAY")
 *             or same ordinal weekday ("SAME_WEEKDAY", e.g. "2nd Tuesday")
 *
 * End condition: endDate XOR maxOccurrences (maxOccurrences hard-capped at 365).
 *
 * Each occurrence is stored as a separate Booking row linked via recurringSeriesId.
 */

const prisma = require('../db/prisma');
const { findConflicts, createBooking } = require('./bookingService');
const logger = require('../logger');

const MAX_OCCURRENCES = 365;

// ---------------------------------------------------------------------------
// Date generation
// ---------------------------------------------------------------------------

/**
 * Return the Nth occurrence of a given weekday in a month.
 * e.g. nth=2, weekday=2 → 2nd Wednesday of the month.
 */
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month, 1));
  const diff  = (weekday - first.getUTCDay() + 7) % 7;
  const day   = 1 + diff + (nth - 1) * 7;
  return day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate() ? day : null;
}

/**
 * Calculate which ordinal weekday a date falls on (e.g. "2nd Tuesday").
 * Returns { nth, weekday }.
 */
function getOrdinalWeekday(date) {
  const d = new Date(date);
  const weekday = d.getUTCDay();
  const nth     = Math.ceil(d.getUTCDate() / 7);
  return { nth, weekday };
}

/**
 * Generate an array of ISO date strings (YYYY-MM-DD) for a recurring series.
 *
 * @param {object} params
 * @param {string}   params.pattern          – "DAILY" | "WEEKLY" | "MONTHLY"
 * @param {number}   params.intervalValue    – repeat every N units
 * @param {number[]} [params.weekdays]       – for WEEKLY: array of weekday ints (0=Sun)
 * @param {string}   [params.monthlyMode]    – "SAME_DAY" | "SAME_WEEKDAY"
 * @param {string}   params.startDate        – ISO "YYYY-MM-DD"
 * @param {string}   [params.endDate]        – ISO "YYYY-MM-DD"
 * @param {number}   [params.maxOccurrences] – stop after N occurrences
 * @returns {string[]} Array of ISO date strings
 */
function generateOccurrenceDates({ pattern, intervalValue = 1, weekdays = [], monthlyMode = 'SAME_DAY', startDate, endDate, maxOccurrences }) {
  const start    = new Date(startDate + 'T00:00:00Z');
  const end      = endDate ? new Date(endDate + 'T00:00:00Z') : null;
  const maxOcc   = Math.min(maxOccurrences || MAX_OCCURRENCES, MAX_OCCURRENCES);
  const dates    = [];
  const interval = Math.max(1, Number(intervalValue));

  if (pattern === 'DAILY') {
    let cur = new Date(start);
    while (dates.length < maxOcc) {
      if (end && cur > end) break;
      dates.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur);
      cur.setUTCDate(cur.getUTCDate() + interval);
    }

  } else if (pattern === 'WEEKLY') {
    const days = weekdays.length > 0 ? weekdays.map(Number) : [start.getUTCDay()];
    // Walk forward week by week; collect each matching weekday within the week
    let weekBase = new Date(start);
    // Snap to start of the current week (Monday of start week)
    const dow    = weekBase.getUTCDay();
    weekBase.setUTCDate(weekBase.getUTCDate() - dow); // snap to Sunday of this week

    while (dates.length < maxOcc) {
      if (end && weekBase > end) break;

      // Collect days within this week that match
      for (const wd of days.sort((a, b) => a - b)) {
        const candidate = new Date(weekBase);
        candidate.setUTCDate(candidate.getUTCDate() + wd);
        if (candidate < start) continue; // skip days before start
        if (end && candidate > end) break;
        dates.push(candidate.toISOString().slice(0, 10));
        if (dates.length >= maxOcc) break;
      }

      // Advance by N weeks
      weekBase.setUTCDate(weekBase.getUTCDate() + 7 * interval);
    }

  } else if (pattern === 'MONTHLY') {
    const { nth, weekday } = getOrdinalWeekday(start);

    let year  = start.getUTCFullYear();
    let month = start.getUTCMonth(); // 0-indexed

    while (dates.length < maxOcc) {
      let day;
      if (monthlyMode === 'SAME_DAY') {
        day = start.getUTCDate();
        // Clamp to last day of month
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        day = Math.min(day, lastDay);
      } else {
        // SAME_WEEKDAY
        day = nthWeekdayOfMonth(year, month, weekday, nth);
        if (!day) {
          month += interval;
          if (month > 11) { year += Math.floor(month / 12); month %= 12; }
          continue;
        }
      }

      const candidate = new Date(Date.UTC(year, month, day));
      if (candidate < start) { /* skip first if before start */ }
      else {
        if (end && candidate > end) break;
        dates.push(candidate.toISOString().slice(0, 10));
      }

      month += interval;
      if (month > 11) { year += Math.floor(month / 12); month %= 12; }
    }
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Conflict checking across all occurrences
// ---------------------------------------------------------------------------

/**
 * Check conflicts for every occurrence in a series.
 * Returns an array of { date, conflicts[] } for dates that have conflicts.
 */
async function checkSeriesConflicts({ roomId, dates, startTime, endTime, excludeSeriesId = null }) {
  const conflictDates = [];

  // Build exclusion list: bookings already in this series (for edits)
  let excludeIds = [];
  if (excludeSeriesId) {
    const existing = await prisma.booking.findMany({
      where: { recurringSeriesId: Number(excludeSeriesId) },
      select: { id: true },
    });
    excludeIds = existing.map(b => b.id);
  }

  for (const date of dates) {
    const conflicts = await findConflicts({ roomId, date, startTime, endTime });
    const filtered  = conflicts.filter(c => !excludeIds.includes(c.id));
    if (filtered.length > 0) {
      conflictDates.push({ date, conflicts: filtered });
    }
  }

  return conflictDates;
}

// ---------------------------------------------------------------------------
// Create series
// ---------------------------------------------------------------------------

/**
 * Create a recurring series and all its occurrence bookings.
 *
 * @param {object} params – series definition + booking fields
 * @returns {{ series, bookings }}
 */
async function createSeries({
  pattern, intervalValue, weekdays, monthlyMode,
  endDate, maxOccurrences,
  // Booking fields (same as createBooking)
  roomId, userId, startDate, startTime, endTime,
  attendeeCount, company, costCentre, seatingLayoutId, title, notes,
  attendeeEmails, cateringSelections,
}) {
  // Generate dates
  const dates = generateOccurrenceDates({ pattern, intervalValue, weekdays, monthlyMode, startDate, endDate, maxOccurrences });
  if (dates.length === 0) throw Object.assign(new Error('No occurrences generated for the given recurrence parameters'), { status: 400 });

  // Conflict check across all occurrences
  const conflicts = await checkSeriesConflicts({ roomId, dates, startTime, endTime });
  if (conflicts.length > 0) {
    const conflictDates = conflicts.map(c => c.date).join(', ');
    throw Object.assign(
      new Error(`Room conflicts on: ${conflictDates}`),
      { status: 400, conflicts }
    );
  }

  // Create the series record
  const endDateObj = endDate ? (() => { const d = new Date(endDate); d.setUTCHours(0,0,0,0); return d; })() : null;
  const series = await prisma.recurringSeries.create({
    data: {
      pattern,
      intervalValue: Number(intervalValue) || 1,
      weekdays: weekdays && weekdays.length > 0 ? JSON.stringify(weekdays.map(Number)) : null,
      monthlyMode: monthlyMode || null,
      endDate: endDateObj,
      maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
    },
  });

  // Create all bookings
  const bookings = [];
  for (const date of dates) {
    const booking = await createBooking({
      roomId, userId, date, startTime, endTime,
      attendeeCount, company, costCentre, seatingLayoutId, title, notes,
      attendeeEmails, cateringSelections,
    });

    // Link to series
    await prisma.booking.update({
      where: { id: booking.id },
      data: { recurringSeriesId: series.id },
    });

    bookings.push({ ...booking, recurringSeriesId: series.id });
  }

  logger.info('Recurring series created', { seriesId: series.id, occurrences: bookings.length, userId });
  return { series, bookings };
}

// ---------------------------------------------------------------------------
// Edit single occurrence
// ---------------------------------------------------------------------------

/**
 * Detach a booking from its series and apply edits.
 * The booking becomes a standalone booking.
 */
async function editSingleOccurrence(bookingId, userId, isAdmin, data) {
  const { updateBooking } = require('./bookingService');
  // Detach from series first
  await prisma.booking.update({
    where: { id: Number(bookingId) },
    data: { recurringSeriesId: null },
  });
  return updateBooking(bookingId, userId, isAdmin, data);
}

// ---------------------------------------------------------------------------
// Cancel single occurrence
// ---------------------------------------------------------------------------

async function cancelSingleOccurrence(bookingId, userId, isAdmin) {
  const { cancelBooking } = require('./bookingService');
  return cancelBooking(bookingId, userId, isAdmin);
}

// ---------------------------------------------------------------------------
// Edit entire series (from a specific occurrence onward, or all)
// ---------------------------------------------------------------------------

/**
 * Cancel all future bookings in the series (from fromDate inclusive)
 * and recreate them with the updated parameters.
 *
 * @param {number} seriesId
 * @param {string} fromDate – ISO "YYYY-MM-DD", only bookings on/after this date are edited
 * @param {object} data     – updated booking fields; recurrence fields unchanged
 * @param {number} userId
 * @param {boolean} isAdmin
 */
async function editSeriesFrom(seriesId, fromDate, userId, isAdmin, data) {
  const series = await prisma.recurringSeries.findUnique({ where: { id: Number(seriesId) } });
  if (!series) throw Object.assign(new Error('Series not found'), { status: 404 });

  const fromDateObj = new Date(fromDate + 'T00:00:00Z');

  // Get all future bookings (ACTIVE, date >= fromDate)
  const futureBookings = await prisma.booking.findMany({
    where: {
      recurringSeriesId: Number(seriesId),
      status: 'ACTIVE',
      date: { gte: fromDateObj },
    },
    orderBy: { date: 'asc' },
  });

  if (futureBookings.length === 0) return [];

  const { roomId = futureBookings[0].roomId, startTime, endTime } = data;
  const targetRoomId = Number(roomId);
  const targetStart  = startTime || futureBookings[0].startTime;
  const targetEnd    = endTime   || futureBookings[0].endTime;

  // Collect dates
  const futureDates = futureBookings.map(b => b.date.toISOString().slice(0, 10));

  // Conflict check for new time/room
  const conflicts = await checkSeriesConflicts({
    roomId: targetRoomId,
    dates: futureDates,
    startTime: targetStart,
    endTime: targetEnd,
    excludeSeriesId: seriesId,
  });
  if (conflicts.length > 0) {
    const conflictDates = conflicts.map(c => c.date).join(', ');
    throw Object.assign(new Error(`Room conflicts on: ${conflictDates}`), { status: 400, conflicts });
  }

  // Cancel old future bookings
  await prisma.booking.updateMany({
    where: {
      recurringSeriesId: Number(seriesId),
      status: 'ACTIVE',
      date: { gte: fromDateObj },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: Number(userId),
    },
  });

  // Re-create with updated data
  const updatedBookings = [];
  for (const date of futureDates) {
    const newBooking = await createBooking({
      roomId: targetRoomId,
      userId: data.userId || futureBookings[0].userId,
      date,
      startTime: targetStart,
      endTime: targetEnd,
      attendeeCount: data.attendeeCount || futureBookings[0].attendeeCount,
      company: data.company !== undefined ? data.company : futureBookings[0].company,
      costCentre: data.costCentre !== undefined ? data.costCentre : futureBookings[0].costCentre,
      seatingLayoutId: data.seatingLayoutId !== undefined ? data.seatingLayoutId : futureBookings[0].seatingLayoutId,
      title: data.title !== undefined ? data.title : futureBookings[0].title,
      notes: data.notes !== undefined ? data.notes : futureBookings[0].notes,
      attendeeEmails: data.attendeeEmails || [],
      cateringSelections: data.cateringSelections || [],
    });
    await prisma.booking.update({ where: { id: newBooking.id }, data: { recurringSeriesId: Number(seriesId) } });
    updatedBookings.push(newBooking);
  }

  logger.info('Series bookings updated', { seriesId, count: updatedBookings.length, from: fromDate });
  return updatedBookings;
}

// ---------------------------------------------------------------------------
// Cancel entire series
// ---------------------------------------------------------------------------

/**
 * Cancel all ACTIVE bookings in a series.
 */
async function cancelSeries(seriesId, userId, isAdmin, fromDate = null) {
  const where = {
    recurringSeriesId: Number(seriesId),
    status: 'ACTIVE',
  };
  if (fromDate) {
    where.date = { gte: new Date(fromDate + 'T00:00:00Z') };
  }

  // Check ownership unless admin
  if (!isAdmin) {
    const bookings = await prisma.booking.findMany({ where, select: { userId: true } });
    if (bookings.some(b => b.userId !== Number(userId))) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
  }

  const result = await prisma.booking.updateMany({
    where,
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: Number(userId),
    },
  });

  logger.info('Series cancelled', { seriesId, count: result.count, userId });
  return result;
}

// ---------------------------------------------------------------------------
// Get series info
// ---------------------------------------------------------------------------

async function getSeriesById(seriesId) {
  return prisma.recurringSeries.findUnique({
    where: { id: Number(seriesId) },
    include: {
      bookings: {
        orderBy: { date: 'asc' },
        include: { room: { select: { id: true, name: true } } },
      },
    },
  });
}

module.exports = {
  generateOccurrenceDates,
  checkSeriesConflicts,
  createSeries,
  editSingleOccurrence,
  cancelSingleOccurrence,
  editSeriesFrom,
  cancelSeries,
  getSeriesById,
};
