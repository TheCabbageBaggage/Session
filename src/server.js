'use strict';

require('dotenv').config();

const http = require('http');
const app = require('./app');
const logger = require('./logger');
const prisma = require('./db/prisma');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

async function start() {
  // Verify database connectivity before accepting requests
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.error('Failed to connect to database', { message: err.message });
    process.exit(1);
  }

  server.listen(PORT, () => {
    logger.info(`Session server running`, {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
    });
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received – shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed');
    process.exit(0);
  });
  // Force exit after 10 seconds
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

start();
