'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const { combine, timestamp, json, colorize, printf, errors } = format;

const LOG_DIR = path.join(__dirname, '../logs');

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${ts} [${level}] ${message}${metaStr}`;
  })
);

function canWriteLogDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const loggerTransports = [
  new transports.Console({ format: consoleFormat }),
];

if (canWriteLogDir(LOG_DIR)) {
  const fileTransport = new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'session-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '30d',
    format: combine(timestamp(), errors({ stack: true }), json()),
  });
  fileTransport.on('error', (err) => {
    // Keep the process running even if file transport fails at runtime.
    console.error('File logging disabled due to transport error:', err.message);
  });
  loggerTransports.push(fileTransport);
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transports: loggerTransports,
});

module.exports = logger;
