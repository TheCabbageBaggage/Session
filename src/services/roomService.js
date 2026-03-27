'use strict';

const prisma = require('../db/prisma');

const ROOM_INCLUDE = {
  cateringOptions: true,
  seatingLayouts: { include: { seatingLayout: true } },
};

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

async function listRooms({ includeInactive = false, type = null } = {}) {
  const where = {};
  if (!includeInactive) where.isActive = true;
  if (type) where.type = type;
  return prisma.room.findMany({
    where,
    include: ROOM_INCLUDE,
    orderBy: { name: 'asc' },
  });
}

async function getRoomById(id) {
  return prisma.room.findUnique({
    where: { id: Number(id) },
    include: ROOM_INCLUDE,
  });
}

async function createRoom({ name, description, location, capacity, type, imagePath, exchangeMailbox, cateringOptions = [], seatingLayoutIds = [] }) {
  return prisma.room.create({
    data: {
      name, description, location,
      capacity: Number(capacity),
      type: type || 'MEETING_ROOM',
      imagePath, exchangeMailbox,
      cateringOptions: {
        create: cateringOptions.map((opt) => ({ cateringOption: opt })),
      },
      seatingLayouts: {
        create: seatingLayoutIds.map((id) => ({ seatingLayoutId: Number(id) })),
      },
    },
    include: ROOM_INCLUDE,
  });
}

async function updateRoom(id, { name, description, location, capacity, type, imagePath, exchangeMailbox, isActive, cateringOptions = [], seatingLayoutIds = [] }) {
  return prisma.$transaction([
    // Clear existing catering and layout relations, then recreate
    prisma.roomCateringOption.deleteMany({ where: { roomId: Number(id) } }),
    prisma.roomSeatingLayout.deleteMany({ where: { roomId: Number(id) } }),
    prisma.room.update({
      where: { id: Number(id) },
      data: {
        name, description, location,
        capacity: Number(capacity),
        type, imagePath, exchangeMailbox,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        cateringOptions: {
          create: cateringOptions.map((opt) => ({ cateringOption: opt })),
        },
        seatingLayouts: {
          create: seatingLayoutIds.map((sid) => ({ seatingLayoutId: Number(sid) })),
        },
      },
    }),
  ]).then((results) => results[2]);
}

async function deleteRoom(id) {
  // Soft-delete: set isActive = false
  return prisma.room.update({ where: { id: Number(id) }, data: { isActive: false } });
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

async function listCompanies({ includeInactive = false } = {}) {
  const where = includeInactive ? {} : { isActive: true };
  return prisma.company.findMany({ where, orderBy: { name: 'asc' } });
}

async function createCompany({ name, isDefault = false }) {
  if (isDefault) {
    await prisma.company.updateMany({ data: { isDefault: false } });
  }
  return prisma.company.create({ data: { name, isDefault: Boolean(isDefault) } });
}

async function updateCompany(id, { name, isDefault, isActive }) {
  if (isDefault) {
    await prisma.company.updateMany({ where: { id: { not: Number(id) } }, data: { isDefault: false } });
  }
  return prisma.company.update({
    where: { id: Number(id) },
    data: { name, isDefault: Boolean(isDefault), isActive: isActive !== undefined ? Boolean(isActive) : undefined },
  });
}

async function deleteCompany(id) {
  return prisma.company.update({ where: { id: Number(id) }, data: { isActive: false } });
}

// ---------------------------------------------------------------------------
// Seating Layouts
// ---------------------------------------------------------------------------

async function listSeatingLayouts({ includeInactive = false } = {}) {
  const where = includeInactive ? {} : { isActive: true };
  return prisma.seatingLayout.findMany({ where, orderBy: { name: 'asc' } });
}

async function getSeatingLayoutById(id) {
  return prisma.seatingLayout.findUnique({ where: { id: Number(id) } });
}

async function createSeatingLayout({ name, description, imagePath }) {
  return prisma.seatingLayout.create({ data: { name, description, imagePath } });
}

async function updateSeatingLayout(id, { name, description, imagePath, isActive }) {
  return prisma.seatingLayout.update({
    where: { id: Number(id) },
    data: { name, description, imagePath, isActive: isActive !== undefined ? Boolean(isActive) : undefined },
  });
}

async function deleteSeatingLayout(id) {
  return prisma.seatingLayout.update({ where: { id: Number(id) }, data: { isActive: false } });
}

module.exports = {
  listRooms, getRoomById, createRoom, updateRoom, deleteRoom,
  listCompanies, createCompany, updateCompany, deleteCompany,
  listSeatingLayouts, getSeatingLayoutById, createSeatingLayout, updateSeatingLayout, deleteSeatingLayout,
};
