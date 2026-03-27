'use strict';

/**
 * Booking service – core booking logic including availability checks,
 * conflict detection, and CRUD operations.
 *
 * Time is stored as "HH:MM" strings. All comparisons are done lexicographically
 * which is valid for zero-padded 24-hour time strings.
 */

const prisma = require('../db/prisma');
const logger = require('../logger');

const BOOKING_INCLUDE = {
  room: true,
  user: { select: { id: true, firstName: true, lastName: true, username: true } },
  seatingLayout: true,
  catering: true,
  attendees: true,
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Return all bookings that overlap [startTime, endTime] on a given date/room.
 * An overlap exists when:  existing.start < newEnd  AND  existing.end > newStart
 */
async function findConflicts({ roomId, date, startTime, endTime, excludeBookingId = null }) {
  const dateObj = new Date(date);
  dateObj.setUTCHours(0, 0, 0, 0);

  return prisma.booking.findMany({
    where: {
      roomId: Number(roomId),
      date: dateObj,
      status: 'ACTIVE',
      AND: [
        { startTime: { lt: endTime } },
        { endTime:   { gt: startTime } },
      ],
      ...(excludeBookingId ? { id: { not: Number(excludeBookingId) } } : {}),
    },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
}

/**
 * Return rooms available for the given time slot.
 * Accepts optional filters: type, minCapacity, cateringOptions[].
 */
async function getAvailableRooms({ date, startTime, endTime, type, minCapacity, cateringOptions = [] }) {
  const dateObj = new Date(date);
  dateObj.setUTCHours(0, 0, 0, 0);

  // Find rooms that have at least one conflicting booking at this time
  const bookedRoomIds = await prisma.booking.findMany({
    where: {
      date: dateObj,
      status: 'ACTIVE',
      AND: [
        { startTime: { lt: endTime } },
        { endTime:   { gt: startTime } },
      ],
    },
    select: { roomId: true },
  });
  const unavailable = new Set(bookedRoomIds.map((b) => b.roomId));

  const where = {
    isActive: true,
    id: { notIn: [...unavailable] },
  };
  if (type) where.type = type;
  if (minCapacity) where.capacity = { gte: Number(minCapacity) };
  if (cateringOptions.length > 0) {
    where.cateringOptions = {
      some: { cateringOption: { in: cateringOptions } },
    };
  }

  return prisma.room.findMany({
    where,
    include: {
      cateringOptions: true,
      seatingLayouts: { include: { seatingLayout: true } },
    },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function createBooking({
  roomId, userId, date, startTime, endTime, attendeeCount,
  company, costCentre, seatingLayoutId, title, notes,
  attendeeEmails = [], cateringSelections = [],
}) {
  // Validate no conflicts
  const conflicts = await findConflicts({ roomId, date, startTime, endTime });
  if (conflicts.length > 0) {
    throw Object.assign(
      new Error('The selected room is not available for this time slot'),
      { status: 400, conflicts }
    );
  }

  const dateObj = new Date(date);
  dateObj.setUTCHours(0, 0, 0, 0);

  const booking = await prisma.booking.create({
    data: {
      roomId: Number(roomId),
      userId: Number(userId),
      date: dateObj,
      startTime,
      endTime,
      attendeeCount: Number(attendeeCount),
      company, costCentre, title, notes,
      seatingLayoutId: seatingLayoutId ? Number(seatingLayoutId) : null,
      attendees: {
        create: attendeeEmails.filter(Boolean).map((email) => ({ email: email.trim() })),
      },
      catering: {
        create: cateringSelections
          .filter((s) => s.option)
          .map((s) => ({ cateringOption: s.option, quantity: Number(s.quantity) || 1 })),
      },
    },
    include: BOOKING_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      userId: Number(userId),
      bookingId: booking.id,
      action: 'BOOKING_CREATED',
      entityType: 'booking',
      entityId: booking.id,
      details: JSON.stringify({ roomId, date, startTime, endTime }),
    },
  });

  logger.info('Booking created', { bookingId: booking.id, userId, roomId });
  return booking;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function getBookingById(id) {
  return prisma.booking.findUnique({ where: { id: Number(id) }, include: BOOKING_INCLUDE });
}

/**
 * List bookings for calendar rendering.
 * Returns bookings for a date range, optionally filtered by room or user.
 */
async function listBookings({ startDate, endDate, roomId = null, userId = null, status = 'ACTIVE' }) {
  const where = { status };
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate)   where.date.lte = new Date(endDate);
  }
  if (roomId) where.roomId = Number(roomId);
  if (userId) where.userId = Number(userId);

  return prisma.booking.findMany({
    where,
    include: {
      room: { select: { id: true, name: true, type: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      seatingLayout: { select: { id: true, name: true } },
      catering: true,
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

/** Bookings for today (used by public room view). */
async function getTodayBookings() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return prisma.booking.findMany({
    where: { date: today, status: 'ACTIVE' },
    include: {
      room: { select: { id: true, name: true, capacity: true, location: true, type: true } },
    },
    orderBy: { startTime: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

async function updateBooking(id, userId, isAdmin, data) {
  const booking = await prisma.booking.findUnique({ where: { id: Number(id) } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status === 'CANCELLED') throw Object.assign(new Error('Cannot edit a cancelled booking'), { status: 400 });
  if (!isAdmin && booking.userId !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const { date, startTime, endTime, roomId, attendeeCount, company, costCentre, seatingLayoutId, title, notes, attendeeEmails = [], cateringSelections = [] } = data;
  const targetRoomId = roomId ? Number(roomId) : booking.roomId;

  const conflicts = await findConflicts({ roomId: targetRoomId, date: date || booking.date, startTime: startTime || booking.startTime, endTime: endTime || booking.endTime, excludeBookingId: id });
  if (conflicts.length > 0) throw Object.assign(new Error('The selected room is not available for this time slot'), { status: 400, conflicts });

  const dateObj = date ? (() => { const d = new Date(date); d.setUTCHours(0,0,0,0); return d; })() : undefined;

  const oldValues = { roomId: booking.roomId, date: booking.date, startTime: booking.startTime, endTime: booking.endTime };

  await prisma.$transaction([
    prisma.bookingAttendee.deleteMany({ where: { bookingId: Number(id) } }),
    prisma.bookingCatering.deleteMany({ where:   { bookingId: Number(id) } }),
    prisma.booking.update({
      where: { id: Number(id) },
      data: {
        ...(dateObj     ? { date: dateObj }         : {}),
        ...(startTime   ? { startTime }             : {}),
        ...(endTime     ? { endTime }               : {}),
        ...(roomId      ? { roomId: targetRoomId }  : {}),
        ...(attendeeCount !== undefined ? { attendeeCount: Number(attendeeCount) } : {}),
        ...(company     !== undefined ? { company }   : {}),
        ...(costCentre  !== undefined ? { costCentre }: {}),
        ...(seatingLayoutId !== undefined ? { seatingLayoutId: seatingLayoutId ? Number(seatingLayoutId) : null } : {}),
        ...(title       !== undefined ? { title }     : {}),
        ...(notes       !== undefined ? { notes }     : {}),
        attendees: { create: attendeeEmails.filter(Boolean).map((email) => ({ email: email.trim() })) },
        catering:  { create: cateringSelections.filter((s) => s.option).map((s) => ({ cateringOption: s.option, quantity: Number(s.quantity) || 1 })) },
      },
    }),
  ]);

  await prisma.auditLog.create({
    data: { userId: Number(userId), bookingId: Number(id), action: 'BOOKING_UPDATED', entityType: 'booking', entityId: Number(id), details: JSON.stringify({ oldValues, newValues: { roomId: targetRoomId, date, startTime, endTime } }) },
  });

  logger.info('Booking updated', { bookingId: id, userId });
  return getBookingById(id);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

async function cancelBooking(id, userId, isAdmin) {
  const booking = await prisma.booking.findUnique({ where: { id: Number(id) } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status === 'CANCELLED') throw Object.assign(new Error('Booking already cancelled'), { status: 400 });
  if (!isAdmin && booking.userId !== Number(userId)) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const updated = await prisma.booking.update({
    where: { id: Number(id) },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: Number(userId) },
  });

  await prisma.auditLog.create({
    data: { userId: Number(userId), bookingId: Number(id), action: 'BOOKING_CANCELLED', entityType: 'booking', entityId: Number(id) },
  });

  logger.info('Booking cancelled', { bookingId: id, userId });
  return updated;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

async function copyBooking(sourceId, userId, { date, startTime, endTime, roomId }) {
  const source = await prisma.booking.findUnique({
    where: { id: Number(sourceId) },
    include: { attendees: true, catering: true },
  });
  if (!source) throw Object.assign(new Error('Booking not found'), { status: 404 });

  return createBooking({
    roomId: roomId || source.roomId,
    userId,
    date: date || source.date,
    startTime: startTime || source.startTime,
    endTime: endTime || source.endTime,
    attendeeCount: source.attendeeCount,
    company: source.company,
    costCentre: source.costCentre,
    seatingLayoutId: source.seatingLayoutId,
    title: source.title ? `Copy of ${source.title}` : null,
    notes: source.notes,
    attendeeEmails: source.attendees.map((a) => a.email),
    cateringSelections: source.catering.map((c) => ({ option: c.cateringOption, quantity: c.quantity })),
  });
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

async function moveBooking(id, userId, isAdmin, { date, startTime, endTime, roomId }) {
  return updateBooking(id, userId, isAdmin, { date, startTime, endTime, roomId });
}

module.exports = {
  findConflicts, getAvailableRooms,
  createBooking, getBookingById, listBookings, getTodayBookings,
  updateBooking, cancelBooking, copyBooking, moveBooking,
};
