'use strict';

const express = require('express');
const router = express.Router();
const prisma = require('../../db/prisma');
const logger = require('../../logger');

/**
 * GET /api/health
 * Returns application health status including database connectivity.
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    checks: {
      database: 'unknown',
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = 'ok';
  } catch (err) {
    health.status = 'degraded';
    health.checks.database = 'error';
    logger.error('Health check – database error', { message: err.message });
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
