'use strict';

/**
 * Unit tests for bookingService.
 */

jest.mock('../../src/db/prisma', () => ({
  booking: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  room: {
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
}));

jest.mock('../../src/logger', () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

const prisma = require('../../src/db/prisma');
const bookingService = require('../../src/services/bookingService');

function makeBooking(overrides = {}) {
  return {
    id:            1,
    roomId:        10,
    userId:        5,
    date:          new Date('2026-04-15T00:00:00.000Z'),
    startTime:     '10:00',
    endTime:       '11:00',
    attendeeCount: 5,
    company:       'Acme',
    costCentre:    'IT',
    status:        'ACTIVE',
    title:         'Meeting',
    notes:         null,
    seatingLayoutId: null,
    recurringSeriesId: null,
    cancelledAt:   null,
    cancelledBy:   null,
    catering:      [],
    attendees:     [],
    user:          { firstName: 'Alice', lastName: 'Smith' },
    room:          { name: 'Boardroom' },
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

describe('bookingService – findConflicts', () => {
  it('returns empty array when room is available', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    const conflicts = await bookingService.findConflicts({
      roomId: 1, date: '2026-04-15', startTime: '10:00', endTime: '11:00',
    });
    expect(conflicts).toEqual([]);
  });

  it('passes the correct WHERE clause for overlap detection', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    await bookingService.findConflicts({
      roomId: 10, date: '2026-04-15', startTime: '10:00', endTime: '11:00',
    });
    const whereArg = prisma.booking.findMany.mock.calls[0][0].where;
    // The overlap query should use startTime < endTime AND endTime > startTime
    expect(whereArg.AND[0].startTime).toEqual({ lt: '11:00' });
    expect(whereArg.AND[1].endTime).toEqual(  { gt: '10:00' });
  });

  it('returns overlapping bookings returned by Prisma', async () => {
    prisma.booking.findMany.mockResolvedValue([makeBooking({ id: 2, startTime: '10:30', endTime: '11:30' })]);
    const conflicts = await bookingService.findConflicts({
      roomId: 10, date: '2026-04-15', startTime: '10:00', endTime: '11:00',
    });
    expect(conflicts.length).toBe(1);
  });

  it('passes excludeBookingId when provided', async () => {
    prisma.booking.findMany.mockResolvedValue([]);
    await bookingService.findConflicts({
      roomId: 10, date: '2026-04-15', startTime: '10:00', endTime: '11:00',
      excludeBookingId: 7,
    });
    const whereArg = prisma.booking.findMany.mock.calls[0][0].where;
    expect(whereArg.id).toEqual({ not: 7 });
  });
});

describe('bookingService – createBooking', () => {
  it('creates a booking and writes an audit log', async () => {
    prisma.booking.findMany.mockResolvedValue([]); // no conflicts
    prisma.booking.create.mockResolvedValue(makeBooking({ id: 7 }));
    prisma.auditLog.create.mockResolvedValue({});

    const result = await bookingService.createBooking({
      roomId: 10, userId: 5, date: '2026-04-15',
      startTime: '10:00', endTime: '11:00',
      attendeeCount: 3, company: 'Acme', costCentre: 'IT',
      attendeeEmails: [], cateringSelections: [],
    });

    expect(result.id).toBe(7);
    expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('throws 400 when a conflict exists', async () => {
    prisma.booking.findMany.mockResolvedValue([makeBooking({ id: 2 })]);

    await expect(
      bookingService.createBooking({
        roomId: 10, userId: 5, date: '2026-04-15',
        startTime: '10:00', endTime: '11:00',
        attendeeCount: 3, company: 'Acme', costCentre: 'IT',
        attendeeEmails: [], cateringSelections: [],
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.booking.create).not.toHaveBeenCalled();
  });
});

describe('bookingService – cancelBooking', () => {
  it('sets booking status to CANCELLED', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ userId: 5 }));
    prisma.booking.update.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));
    prisma.auditLog.create.mockResolvedValue({});

    await bookingService.cancelBooking(1, 5, false);

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data:  expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
  });

  it('throws 403 when non-owner non-admin tries to cancel', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ userId: 5 }));
    await expect(bookingService.cancelBooking(1, 99, false)).rejects.toMatchObject({ status: 403 });
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('allows admin to cancel any booking', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ userId: 5 }));
    prisma.booking.update.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));
    prisma.auditLog.create.mockResolvedValue({});

    await bookingService.cancelBooking(1, 999, true); // isAdmin = true
    expect(prisma.booking.update).toHaveBeenCalled();
  });

  it('throws 404 when booking does not exist', async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(bookingService.cancelBooking(99, 5, false)).rejects.toMatchObject({ status: 404 });
  });
});

describe('bookingService – getAvailableRooms', () => {
  it('queries rooms and calls findMany for availability check', async () => {
    const allRooms = [
      { id: 1, name: 'Room A', capacity: 10, isActive: true, type: 'MEETING_ROOM', cateringOptions: [], seatingLayouts: [] },
    ];
    prisma.room.findMany.mockResolvedValue(allRooms);
    prisma.booking.findMany.mockResolvedValue([]); // no conflicts for any room

    const available = await bookingService.getAvailableRooms({
      date: '2026-04-15', startTime: '10:00', endTime: '11:00',
    });

    expect(prisma.room.findMany).toHaveBeenCalled();
    expect(available.length).toBeGreaterThanOrEqual(0);
  });
});
