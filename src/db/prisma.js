'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('../logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    logger.debug('DB query', { query: e.query, duration: e.duration });
  });
}

prisma.$on('error', (e) => {
  logger.error('DB error', { message: e.message });
});

prisma.$on('warn', (e) => {
  logger.warn('DB warning', { message: e.message });
});

module.exports = prisma;
