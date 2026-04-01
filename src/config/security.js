'use strict';

const crypto = require('crypto');

let jwtSecret = null;

function getJwtSecret() {
  if (jwtSecret) return jwtSecret;

  const configured = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';
  if (configured) {
    jwtSecret = configured;
    return jwtSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  // Non-production fallback: random per process, avoids insecure hardcoded secrets.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  return jwtSecret;
}

module.exports = { getJwtSecret };
