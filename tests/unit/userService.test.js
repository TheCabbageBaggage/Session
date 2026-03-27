'use strict';

// Unit tests for userService – isolate Prisma behind a mock

jest.mock('../../src/db/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  userProfile: {
    upsert: jest.fn(),
  },
  userRole: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  role: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

const prisma = require('../../src/db/prisma');
const userService = require('../../src/services/userService');

describe('userService', () => {

  afterEach(() => jest.clearAllMocks());

  describe('setActive', () => {
    it('deactivates a non-protected user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2, isProtected: false });
      prisma.user.update.mockResolvedValue({ id: 2, isActive: false });
      await userService.setActive(2, false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { isActive: false },
      });
    });

    it('throws 400 when trying to deactivate a protected account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1, isProtected: true });
      await expect(userService.setActive(1, false)).rejects.toMatchObject({ status: 400 });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws 404 when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(userService.setActive(99, false)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('changePassword', () => {
    it('hashes and saves the new password, clears mustChangePwd', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1, isLocal: true });
      prisma.user.update.mockResolvedValue({});
      await userService.changePassword(1, 'newpassword123');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { passwordHash: '$2b$12$hashedpassword', mustChangePwd: false },
      });
    });

    it('throws 400 when password is too short', async () => {
      await expect(userService.changePassword(1, 'short')).rejects.toMatchObject({ status: 400 });
    });

    it('throws 400 for non-local accounts', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2, isLocal: false });
      await expect(userService.changePassword(2, 'validpassword')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('countDefaultPasswordAccounts', () => {
    it('returns the count of local accounts with mustChangePwd=true', async () => {
      prisma.user.count.mockResolvedValue(2);
      const count = await userService.countDefaultPasswordAccounts();
      expect(count).toBe(2);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { isLocal: true, mustChangePwd: true },
      });
    });
  });

  describe('updateProfile', () => {
    it('upserts the user profile', async () => {
      prisma.userProfile.upsert.mockResolvedValue({ userId: 1, company: 'Acme', costCentre: 'IT', language: 'de' });
      const result = await userService.updateProfile(1, { company: 'Acme', costCentre: 'IT', language: 'de' });
      expect(result.company).toBe('Acme');
      expect(prisma.userProfile.upsert).toHaveBeenCalled();
    });
  });

});
