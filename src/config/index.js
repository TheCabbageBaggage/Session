'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../../config');

function loadConfig(filename) {
  const filePath = path.join(CONFIG_DIR, filename);
  const examplePath = path.join(CONFIG_DIR, filename.replace('.json', '.example.json'));

  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  if (fs.existsSync(examplePath)) {
    return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  }
  throw new Error(`Configuration file not found: ${filename}`);
}

let _app, _db, _ad, _smtp, _exchange, _roles, _i18n;

function app()      { return (_app      ??= loadConfig('app.config.json')); }
function db()       { return (_db       ??= loadConfig('database.config.json')); }
function ad()       { return (_ad       ??= loadConfig('ad.config.json')); }
function smtp()     { return (_smtp     ??= loadConfig('smtp.config.json')); }
function exchange() { return (_exchange ??= loadConfig('exchange.config.json')); }
function roles()    { return (_roles    ??= loadConfig('roles.config.json')); }
function i18n()     { return (_i18n     ??= loadConfig('i18n.config.json')); }

function reload() {
  _app = _db = _ad = _smtp = _exchange = _roles = _i18n = undefined;
}

module.exports = { app, db, ad, smtp, exchange, roles, i18n, reload };
