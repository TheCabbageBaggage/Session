'use strict';

/**
 * User service – shared user management operations used by routes and admin UI.
 */

const prisma = require('../db/prisma');
const bcrypt = require('bcryptjs');
const logger = require('../logger');

const BCRYPT_ROUNDS = 12;

const USER_INCLUDE = {
  roles: { include: { role: true } },
  profile: true,
};

/** Paginated user list with optional search and role filter. */
async function listUsers({ search = '', roleId = null, page = 1, pageSize = 25 } = {}) {
  const where = {
    AND: [
      search
        ? {
            OR: [
              { username:  { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName:  { contains: search, mode: 'insensitive' } },
              { email:     { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      roleId ? { roles: { some: { roleId: Number(roleId) } } } : {},
    ],
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: USER_INCLUDE,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** Get a single user with all relations. */
async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id: Number(id) },
    include: USER_INCLUDE,
  });
}

/**
 * Update user profile (company, costCentre, language).
 * Called by both users editing their own profile and admins editing any profile.
 */
async function updateProfile(userId, { company, costCentre, language }) {
  return prisma.userProfile.upsert({
    where: { userId: Number(userId) },
    update: { company, costCentre, language: language || 'en' },
    create: { userId: Number(userId), company, costCentre, language: language || 'en' },
  });
}

/**
 * Update user AD-sourced fields (admin only – e.g. manually correct a name).
 */
async function updateUserFields(userId, { firstName, lastName, email }) {
  return prisma.user.update({
    where: { id: Number(userId) },
    data: { firstName, lastName, email },
  });
}

/** Set a user's active status. Protected accounts cannot be deactivated. */
async function setActive(userId, active) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.isProtected && !active) {
    throw Object.assign(
      new Error('The built-in admin account cannot be deactivated'),
      { status: 400 }
    );
  }
  return prisma.user.update({ where: { id: Number(userId) }, data: { isActive: active } });
}

/**
 * Override a user's role (admin-only).
 * Removes all existing roles and assigns the new one.
 */
async function setRole(userId, roleId) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const role = await prisma.role.findUnique({ where: { id: Number(roleId) } });
  if (!role) throw Object.assign(new Error('Role not found'), { status: 404 });

  // Protected admin cannot be demoted below Administrator
  if (user.isProtected && role.name !== 'Administrator') {
    throw Object.assign(
      new Error('The built-in admin account cannot be demoted below Administrator'),
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: Number(userId) } }),
    prisma.userRole.create({ data: { userId: Number(userId), roleId: Number(roleId) } }),
  ]);

  logger.info('User role changed', { userId, roleId, roleName: role.name });
}

/**
 * Change password for a local account.
 * Validates minimum length, hashes with bcrypt, clears mustChangePwd.
 */
async function changePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(
      new Error('Password must be at least 8 characters long'),
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (!user.isLocal) {
    throw Object.assign(
      new Error('Password changes are only available for local accounts'),
      { status: 400 }
    );
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  return prisma.user.update({
    where: { id: Number(userId) },
    data: { passwordHash: hash, mustChangePwd: false },
  });
}

/** Count local accounts still using their factory password (mustChangePwd = true). */
async function countDefaultPasswordAccounts() {
  return prisma.user.count({ where: { isLocal: true, mustChangePwd: true } });
}

module.exports = {
  listUsers,
  getUserById,
  updateProfile,
  updateUserFields,
  setActive,
  setRole,
  changePassword,
  countDefaultPasswordAccounts,
};
