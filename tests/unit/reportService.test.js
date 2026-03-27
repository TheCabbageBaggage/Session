'use strict';

/**
 * Unit tests for reportService.
 */

jest.mock('../../src/db/prisma', () => ({
  booking: {
    findMany:  jest.fn(),
    groupBy:   jest.fn(),
  },
  bookingCatering: {
    groupBy: jest.fn(),
  },
  room: {
    findMany: jest.fn(),
    count:    jest.fn(),
  },
  exchangeSyncLog: {
    count: jest.fn(),
  },
}));

const prisma = require('../../src/db/prisma');
const reportService = require('../../src/services/reportService');

afterEach(() => jest.clearAllMocks());

describe('reportService – getBookingsByCostCentre', () => {
  it('maps Prisma groupBy results to { costCentre, count } shape', async () => {
    prisma.booking.groupBy.mockResolvedValue([
      { costCentre: 'IT',  _count: { id: 5 } },
      { costCentre: null,  _count: { id: 2 } },
    ]);

    const result = await reportService.getBookingsByCostCentre({
      startDate: '2026-01-01', endDate: '2026-01-31',
    });

    expect(result[0]).toEqual({ costCentre: 'IT',     count: 5 });
    expect(result[1]).toEqual({ costCentre: '(none)', count: 2 });
  });
});

describe('reportService – getBookingsByCompany', () => {
  it('maps null company to "(none)"', async () => {
    prisma.booking.groupBy.mockResolvedValue([
      { company: 'Acme Corp', _count: { id: 3 } },
      { company: null,        _count: { id: 1 } },
    ]);

    const result = await reportService.getBookingsByCompany({
      startDate: '2026-01-01', endDate: '2026-01-31',
    });

    expect(result[1].company).toBe('(none)');
  });
});

describe('reportService – getRoomUtilisation', () => {
  it('calculates utilisation percentage for each room', async () => {
    const rooms = [
      { id: 1, name: 'Boardroom', location: 'Floor 1', capacity: 10, isActive: true },
    ];
    prisma.room.findMany.mockResolvedValue(rooms);
    // One booking from 10:00–11:00 (60 min)
    prisma.booking.findMany.mockResolvedValue([
      { roomId: 1, startTime: '10:00', endTime: '11:00' },
    ]);

    const result = await reportService.getRoomUtilisation({
      startDate: '2026-01-01', endDate: '2026-01-01', // 1 day
    });

    expect(result.length).toBe(1);
    expect(result[0].roomName).toBe('Boardroom');
    expect(result[0].totalMinutes).toBe(60);
    // 60 booked out of 840 available = ~7%
    expect(result[0].utilisationPct).toBe(Math.round(60 / 840 * 100));
  });

  it('returns 0% utilisation for rooms with no bookings', async () => {
    prisma.room.findMany.mockResolvedValue([
      { id: 2, name: 'Quiet Room', location: '', capacity: 4, isActive: true },
    ]);
    prisma.booking.findMany.mockResolvedValue([]);

    const result = await reportService.getRoomUtilisation({
      startDate: '2026-01-01', endDate: '2026-01-07',
    });

    expect(result[0].utilisationPct).toBe(0);
    expect(result[0].totalMinutes).toBe(0);
  });
});

describe('reportService – getDashboardKpis', () => {
  it('returns an object with all expected KPI keys', async () => {
    prisma.room.count.mockResolvedValue(5);
    prisma.booking.findMany.mockResolvedValue([]);
    prisma.booking.groupBy.mockResolvedValue([]);
    prisma.bookingCatering.groupBy.mockResolvedValue([]);
    prisma.exchangeSyncLog.count.mockResolvedValue(0);
    prisma.room.findMany.mockResolvedValue([]);

    const kpis = await reportService.getDashboardKpis();

    expect(kpis).toHaveProperty('occupiedRooms');
    expect(kpis).toHaveProperty('totalActiveRooms');
    expect(kpis).toHaveProperty('utilisationPct');
    expect(kpis).toHaveProperty('topRooms');
    expect(kpis).toHaveProperty('topCostCentres');
    expect(kpis).toHaveProperty('cateringSummary');
    expect(kpis).toHaveProperty('exchangeFailedCount');
    expect(kpis.totalActiveRooms).toBe(5);
    expect(kpis.exchangeFailedCount).toBe(0);
  });
});

describe('reportService – getCateringQuantities', () => {
  it('sums catering quantities by option', async () => {
    prisma.bookingCatering.groupBy.mockResolvedValue([
      { cateringOption: 'NON_ALCOHOLIC_BEVERAGES', _sum: { quantity: 25 } },
      { cateringOption: 'BREAD_ROLLS', _sum: { quantity: 10 } },
    ]);

    const result = await reportService.getCateringQuantities({
      startDate: '2026-01-01', endDate: '2026-01-31',
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ option: 'NON_ALCOHOLIC_BEVERAGES', quantity: 25 });
    expect(result[1]).toEqual({ option: 'BREAD_ROLLS', quantity: 10 });
  });
});
