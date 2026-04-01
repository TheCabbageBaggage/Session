'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../locales');
const cache = {};

function loadLocale(lang) {
  if (cache[lang]) return cache[lang];
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  if (!fs.existsSync(filePath)) return {};
  cache[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return cache[lang];
}

/**
 * Attach translation function req.t(key, vars) to every request.
 * Language is resolved from: user profile > query param > Accept-Language > default.
 */
function i18nMiddleware(req, res, next) {
  const lang = req.user?.profile?.language
    || req.query?.lang
    || (req.headers['accept-language'] || '').slice(0, 2)
    || 'en';

  const normalised = ['en', 'de'].includes(lang) ? lang : 'en';
  req.lang = normalised;

  const strings = loadLocale(normalised);
  const fallback = normalised !== 'en' ? loadLocale('en') : {};

  req.t = (key, vars) => {
    const parts = key.split('.');
    let val = parts.reduce((obj, k) => obj?.[k], strings)
           ?? parts.reduce((obj, k) => obj?.[k], fallback)
           ?? key;

    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        val = val.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      });
    }
    return val;
  };

  res.locals.t = req.t;
  res.locals.lang = normalised;
  res.locals.user = req.user || null;
  res.locals.isAdmin = req.user?.roles?.some((ur) => ur.role.name === 'Administrator') ?? false;

  next();
}

module.exports = i18nMiddleware;
