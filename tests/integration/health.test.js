'use strict';

/**
 * Integration test for GET /api/health
 * Uses supertest with a mocked Prisma client.
 */

// Mock Prisma before loading the app
jest.mock('../../src/db/prisma', () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  $on: jest.fn(),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/health', () => {
  it('returns 200 with status ok when DB is reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 when DB is unreachable', async () => {
    const prisma = require('../../src/db/prisma');
    prisma.$queryRaw.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database).toBe('error');
  });
});
