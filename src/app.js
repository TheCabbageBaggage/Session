'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./logger');
const i18nMiddleware = require('./middleware/i18n');
const { attachCsrfToken, requireCsrf } = require('./middleware/csrf');
const { optionalAuth, enforcePasswordChange } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const indexRouter    = require('./routes/index');
const authRouter     = require('./routes/auth');
const bookingsRouter = require('./routes/bookings');
const adminRouter    = require('./routes/admin/index');
const reportsRouter  = require('./routes/admin/reports');
const publicRouter   = require('./routes/public');
const profileRouter  = require('./routes/profile');
const healthRouter    = require('./routes/api/health');
const usersApiRouter  = require('./routes/api/users');
const roomsApiRouter  = require('./routes/api/rooms');
const bookingsApiRouter = require('./routes/api/bookings');

const app = express();

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    },
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

// ---------------------------------------------------------------------------
// General middleware
// ---------------------------------------------------------------------------
app.use(compression());

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/api/health',
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(attachCsrfToken);
app.use(requireCsrf);

// Static files
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d' }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// i18n & optional auth (for locals in all views)
// ---------------------------------------------------------------------------
app.use(optionalAuth);
app.use(i18nMiddleware);
app.use(enforcePasswordChange);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api', apiLimiter);
app.use('/api/health',   healthRouter);
app.use('/api/users',    usersApiRouter);
app.use('/api/rooms',    roomsApiRouter);
app.use('/api/bookings', bookingsApiRouter);

app.use('/login',    loginLimiter);  // rate-limit login attempts
app.use('/public',   publicRouter);
app.use('/profile',  profileRouter);
app.use('/bookings',       bookingsRouter);
app.use('/admin/reports',  reportsRouter);
app.use('/admin',          adminRouter);
app.use('/',         authRouter);    // handles /login, /logout, /change-password
app.use('/',         indexRouter);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
