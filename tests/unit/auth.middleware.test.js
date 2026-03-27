'use strict';

// Unit tests for auth middleware utilities

const { isAdmin } = require('../../src/middleware/auth');

describe('isAdmin', () => {
  it('returns false for null user', () => {
    expect(isAdmin(null)).toBe(false);
  });

  it('returns false for user with no roles', () => {
    expect(isAdmin({ roles: [] })).toBe(false);
  });

  it('returns false for user with only Employee role', () => {
    expect(isAdmin({ roles: [{ role: { name: 'Employee' } }] })).toBe(false);
  });

  it('returns true for user with Administrator role', () => {
    expect(isAdmin({ roles: [{ role: { name: 'Administrator' } }] })).toBe(true);
  });

  it('returns true for user with mixed roles including Administrator', () => {
    expect(isAdmin({
      roles: [
        { role: { name: 'Employee' } },
        { role: { name: 'Administrator' } },
      ],
    })).toBe(true);
  });
});
