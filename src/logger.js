'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, json, colorize, printf, errors } = format;

const LOG_DIR = path.join(__dirname, '../logs');

const fileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'session-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  format: combine(timestamp(), errors({ stack: true }), json()),
});

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${ts} [${level}] ${message}${metaStr}`;
  })
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transports: [
    new transports.Console({ format: consoleFormat }),
    fileTransport,
  ],
});

module.exports = logger;
