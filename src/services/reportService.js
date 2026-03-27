'use strict';

/**
 * Report Service – M5
 * Provides aggregated booking data for the reporting module and admin dashboard.
 */

const prisma = require('../db/prisma');

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function endOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999));
}

/** Parse "HH:MM" into minutes since midnight */
function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function durationMin(start, end) {
  return Math.max(0, timeToMin(end) - timeToMin(start));
}

// ---------------------------------------------------------------------------
// Report: bookings per cost centre
// ---------------------------------------------------------------------------

async function getBookingsByCostCentre({ startDate, endDate }) {
  const rows = await prisma.booking.groupBy({
    by:    ['costCentre'],
    where: {
      date:   { gte: new Date(startDate), lte: new Date(endDate) },
      status: 'ACTIVE',
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  return rows.map(r => ({
    costCentre: r.costCentre || '(none)',
    count:      r._count.id,
  }));
}

// ---------------------------------------------------------------------------
// Report: bookings per room
// ---------------------------------------------------------------------------

async function getBookingsByRoom({ startDate, endDate }) {
  const bookings = await prisma.booking.findMany({
    where: {
      date:   { gte: new Date(startDate), lte: new Date(endDate) },
      status: 'ACTIVE',
    },
    include: { room: { select: { id: true, name: true } } },
  });

  const map = {};
  for (const b of bookings) {
    const key = b.roomId;
    if (!map[key]) map[key] = { roomId: key, roomName: b.room ? b.room.name : `Room #${key}`, count: 0, totalMinutes: 0 };
    map[key].count++;
    map[key].totalMinutes += durationMin(b.startTime, b.endTime);
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Report: room utilisation
// ---------------------------------------------------------------------------

async function getRoomUtilisation({ startDate, endDate }) {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const days  = Math.max(1, Math.round((end - start) / 86_400_000) + 1);

  // Available minutes per room per day: 07:00–21:00 = 840 minutes
  const AVAILABLE_MIN_PER_DAY = 840;
  const totalAvailable = days * AVAILABLE_MIN_PER_DAY;

  const rooms = await prisma.room.findMany({
    where:   { isActive: true },
    orderBy: { name: 'asc' },
  });

  const bookings = await prisma.booking.findMany({
    where: {
      date:   { gte: start, lte: end },
      status: 'ACTIVE',
    },
    select: { roomId: true, startTime: true, endTime: true },
  });

  const usedMin = {};
  for (const b of bookings) {
    usedMin[b.roomId] = (usedMin[b.roomId] || 0) + durationMin(b.startTime, b.endTime);
  }

  return rooms.map(r => {
    const used     = usedMin[r.id] || 0;
    const pct      = totalAvailable > 0 ? Math.min(100, Math.round(used / totalAvailable * 100)) : 0;
    return {
      roomId:          r.id,
      roomName:        r.name,
      location:        r.location || '',
      capacity:        r.capacity,
      totalMinutes:    used,
      availableMinutes: totalAvailable,
      utilisationPct:  pct,
    };
  });
}

// ---------------------------------------------------------------------------
// Report: catering quantities
// ---------------------------------------------------------------------------

async function getCateringQuantities({ startDate, endDate }) {
  const rows = await prisma.bookingCatering.groupBy({
    by: ['cateringOption'],
    where: {
      booking: {
        date:   { gte: new Date(startDate), lte: new Date(endDate) },
        status: 'ACTIVE',
      },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
  });

  return rows.map(r => ({
    option:   r.cateringOption,
    quantity: r._sum.quantity || 0,
  }));
}

// ---------------------------------------------------------------------------
// Report: bookings per company
// ---------------------------------------------------------------------------

async function getBookingsByCompany({ startDate, endDate }) {
  const rows = await prisma.booking.groupBy({
    by:    ['company'],
    where: {
      date:   { gte: new Date(startDate), lte: new Date(endDate) },
      status: 'ACTIVE',
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  return rows.map(r => ({
    company: r.company || '(none)',
    count:   r._count.id,
  }));
}

// ---------------------------------------------------------------------------
// Report: cancelled bookings
// ---------------------------------------------------------------------------

async function getCancelledBookings({ startDate, endDate }) {
  return prisma.booking.findMany({
    where: {
      date:   { gte: new Date(startDate), lte: new Date(endDate) },
      status: 'CANCELLED',
    },
    include: {
      room: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Dashboard KPIs
// ---------------------------------------------------------------------------

async function getDashboardKpis() {
  const now       = new Date();
  const todayUtc  = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const monthStart = startOfMonth(now);
  const monthEnd   = endOfMonth(now);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const [
    totalActiveRooms,
    currentlyOccupied,
    topRoomsThisMonth,
    topCostCentres,
    cateringThisMonth,
    exchangeFailedCount,
  ] = await Promise.all([
    // Total active rooms
    prisma.room.count({ where: { isActive: true } }),

    // Rooms occupied right now
    prisma.booking.findMany({
      where: {
        date:      todayUtc,
        status:    'ACTIVE',
        startTime: { lte: currentTime },
        endTime:   { gt:  currentTime },
      },
      distinct: ['roomId'],
      select:   { roomId: true },
    }),

    // Top 5 rooms this month
    prisma.booking.groupBy({
      by:    ['roomId'],
      where: { date: { gte: monthStart, lte: monthEnd }, status: 'ACTIVE' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take:  5,
    }),

    // Top 5 cost centres this month
    prisma.booking.groupBy({
      by:    ['costCentre'],
      where: { date: { gte: monthStart, lte: monthEnd }, status: 'ACTIVE' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take:  5,
    }),

    // Catering quantities this month
    prisma.bookingCatering.groupBy({
      by: ['cateringOption'],
      where: { booking: { date: { gte: monthStart, lte: monthEnd }, status: 'ACTIVE' } },
      _sum: { quantity: true },
    }),

    // Failed Exchange syncs (unresolved)
    prisma.exchangeSyncLog.count({ where: { status: 'FAILED' } }),
  ]);

  // Enrich top rooms with names
  const roomIds  = topRoomsThisMonth.map(r => r.roomId);
  const roomsMap = {};
  if (roomIds.length) {
    const rooms = await prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } });
    rooms.forEach(r => { roomsMap[r.id] = r.name; });
  }

  return {
    occupiedRooms:     currentlyOccupied.length,
    totalActiveRooms,
    utilisationPct:    totalActiveRooms > 0 ? Math.round(currentlyOccupied.length / totalActiveRooms * 100) : 0,
    topRooms:          topRoomsThisMonth.map(r => ({
      roomId:   r.roomId,
      roomName: roomsMap[r.roomId] || `Room #${r.roomId}`,
      count:    r._count.id,
    })),
    topCostCentres:    topCostCentres.map(r => ({
      costCentre: r.costCentre || '(none)',
      count:      r._count.id,
    })),
    cateringSummary:   cateringThisMonth.map(r => ({
      option:   r.cateringOption,
      quantity: r._sum.quantity || 0,
    })),
    exchangeFailedCount,
  };
}

module.exports = {
  getBookingsByCostCentre,
  getBookingsByRoom,
  getRoomUtilisation,
  getCateringQuantities,
  getBookingsByCompany,
  getCancelledBookings,
  getDashboardKpis,
  startOfMonth,
  endOfMonth,
};
