'use strict';

// Unit tests for i18n middleware

// Mock fs to provide locale strings in tests
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: (p) => p.includes('en.json') || p.includes('de.json'),
    readFileSync: (p) => {
      if (p.includes('en.json')) {
        return JSON.stringify({ nav: { bookings: 'Bookings' }, auth: { login: 'Sign In' } });
      }
      if (p.includes('de.json')) {
        return JSON.stringify({ nav: { bookings: 'Buchungen' }, auth: { login: 'Anmelden' } });
      }
      return '{}';
    },
  };
});

// Clear module cache so our mock takes effect
jest.resetModules();
const i18nMiddleware = require('../../src/middleware/i18n');

describe('i18n middleware', () => {
  function makeReqRes(lang, userLang) {
    const req = {
      user: userLang ? { profile: { language: userLang }, roles: [] } : null,
      query: {},
      headers: {},
      cookies: {},
    };
    const res = { locals: {} };
    const next = jest.fn();
    if (lang) req.headers['accept-language'] = lang;
    return { req, res, next };
  }

  it('defaults to "en" when no language hint', () => {
    const { req, res, next } = makeReqRes(null, null);
    i18nMiddleware(req, res, next);
    expect(req.lang).toBe('en');
    expect(next).toHaveBeenCalled();
  });

  it('resolves "de" from user profile', () => {
    const { req, res, next } = makeReqRes(null, 'de');
    i18nMiddleware(req, res, next);
    expect(req.lang).toBe('de');
  });

  it('translates a known key in English', () => {
    const { req, res, next } = makeReqRes(null, 'en');
    i18nMiddleware(req, res, next);
    expect(req.t('nav.bookings')).toBe('Bookings');
  });

  it('translates a known key in German', () => {
    const { req, res, next } = makeReqRes(null, 'de');
    i18nMiddleware(req, res, next);
    expect(req.t('nav.bookings')).toBe('Buchungen');
  });

  it('falls back to key when translation is missing', () => {
    const { req, res, next } = makeReqRes(null, 'en');
    i18nMiddleware(req, res, next);
    expect(req.t('unknown.key')).toBe('unknown.key');
  });

  it('falls back to "en" for unsupported language', () => {
    const { req, res, next } = makeReqRes('fr', null);
    i18nMiddleware(req, res, next);
    expect(req.lang).toBe('en');
  });
});
