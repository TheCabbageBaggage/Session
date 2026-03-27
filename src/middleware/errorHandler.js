'use strict';

const logger = require('../logger');

/**
 * Centralised error handling middleware.
 * Catches all errors passed via next(err) and returns a JSON or HTML response.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal Server Error';

  logger.error('Request error', {
    status,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
  });

  if (req.accepts('json') && req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('error', {
    title: `Error ${status}`,
    status,
    message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : null,
    user: req.user || null,
    lang: req.lang || 'en',
    t: req.t || ((k) => k),
  });
}

function notFound(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
}

module.exports = { errorHandler, notFound };
