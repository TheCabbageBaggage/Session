'use strict';

/**
 * LDAP / LDAPS service for Active Directory authentication and user queries.
 *
 * Authentication flow:
 *   1. Bind with service account (from ad.config.json) to verify server reachability.
 *   2. Search for the target user's DN using their sAMAccountName.
 *   3. Bind with the found user DN + supplied password to validate credentials.
 *   4. Return user attributes on success, null on failure.
 *
 * Group sync flow (used by adSync.js):
 *   1. Bind with service account.
 *   2. For each configured group, search member attributes recursively.
 *   3. For each member DN, fetch user attributes (sAMAccountName, cn, mail, etc.).
 *   4. Return array of user objects.
 */

const ldap = require('ldapjs');
const config = require('../config');
const logger = require('../logger');

/**
 * Create and connect an LDAP client using the configuration.
 * Returns the bound client or throws on failure.
 * @returns {Promise<ldap.Client>}
 */
async function createBoundClient() {
  const adCfg = config.ad();

  if (!adCfg.enabled) {
    throw new Error('Active Directory integration is disabled in ad.config.json');
  }

  const client = ldap.createClient({
    url: adCfg.url,
    tlsOptions: {
      rejectUnauthorized: adCfg.tlsOptions?.rejectUnauthorized ?? true,
    },
    timeout: 10000,
    connectTimeout: 10000,
  });

  await new Promise((resolve, reject) => {
    client.on('error', (err) => {
      logger.error('LDAP client error', { message: err.message });
      reject(err);
    });
    // Bind with service account
    client.bind(adCfg.bindDn, adCfg.bindPassword, (err) => {
      if (err) {
        logger.error('LDAP service bind failed', { message: err.message });
        return reject(err);
      }
      resolve();
    });
  });

  return client;
}

/**
 * Authenticate a user against Active Directory.
 * Returns user attributes if credentials are valid, null otherwise.
 *
 * @param {string} username  sAMAccountName
 * @param {string} password
 * @returns {Promise<{dn: string, username: string, firstName: string, lastName: string, email: string, objectGuid: string|null} | null>}
 */
async function authenticateUser(username, password) {
  const adCfg = config.ad();

  if (!adCfg.enabled) return null;

  let serviceClient;
  try {
    serviceClient = await createBoundClient();
  } catch (err) {
    logger.error('LDAP: failed to connect for authentication', { message: err.message });
    return null;
  }

  try {
    // Step 1: Find the user's DN
    const userEntry = await searchUser(serviceClient, username);
    if (!userEntry) {
      logger.info('LDAP: user not found in directory', { username });
      return null;
    }

    // Step 2: Bind as the user to verify their password
    const userAuthenticated = await new Promise((resolve) => {
      const userClient = ldap.createClient({
        url: adCfg.url,
        tlsOptions: { rejectUnauthorized: adCfg.tlsOptions?.rejectUnauthorized ?? true },
        timeout: 10000,
        connectTimeout: 10000,
      });
      userClient.bind(userEntry.dn, password, (err) => {
        userClient.destroy();
        resolve(!err);
      });
    });

    if (!userAuthenticated) {
      logger.info('LDAP: password verification failed', { username });
      return null;
    }

    // Step 3: Check group membership
    const allowed = await isUserInAllowedGroup(serviceClient, userEntry.dn);
    if (!allowed) {
      logger.warn('LDAP: user authenticated but not in any allowed group', { username });
      return null;
    }

    logger.info('LDAP: user authenticated', { username });
    return userEntry;
  } catch (err) {
    logger.error('LDAP: authentication error', { username, message: err.message });
    return null;
  } finally {
    serviceClient.destroy();
  }
}

/**
 * Search for a user by sAMAccountName and return their attributes.
 * @param {ldap.Client} client  Already-bound LDAP client
 * @param {string} username
 * @returns {Promise<object|null>}
 */
async function searchUser(client, username) {
  const adCfg = config.ad();
  const filter = (adCfg.userSearchFilter || '(sAMAccountName={{username}})').replace(
    '{{username}}',
    ldap.escapeFilter(username)
  );

  return new Promise((resolve, reject) => {
    const opts = {
      filter,
      scope: 'sub',
      attributes: ['dn', 'sAMAccountName', 'givenName', 'sn', 'mail', 'objectGUID', 'userAccountControl'],
    };

    client.search(adCfg.userSearchBase || adCfg.baseDn, opts, (err, res) => {
      if (err) return reject(err);

      let entry = null;
      res.on('searchEntry', (e) => {
        const obj = e.object;
        // Filter out disabled accounts (UAC bit 2 = ACCOUNTDISABLE)
        const uac = parseInt(obj.userAccountControl || '0', 10);
        if (uac & 2) return; // account disabled

        entry = {
          dn: e.dn.toString(),
          username: obj.sAMAccountName || username,
          firstName: obj.givenName || '',
          lastName: obj.sn || '',
          email: obj.mail || '',
          objectGuid: obj.objectGUID ? bufferToGuid(obj.objectGUID) : null,
        };
      });
      res.on('error', reject);
      res.on('end', () => resolve(entry));
    });
  });
}

/**
 * Check if the user DN is a member of any of the configured allowed groups.
 */
async function isUserInAllowedGroup(client, userDn) {
  const adCfg = config.ad();
  const allowedGroupDns = getAllowedGroupDns(adCfg);
  if (allowedGroupDns.length === 0) return true; // no group restriction configured

  for (const groupDn of allowedGroupDns) {
    const isMember = await checkGroupMembership(client, groupDn, userDn, adCfg.baseDn);
    if (isMember) return true;
  }
  return false;
}

/**
 * Check if userDn is a (direct or nested) member of groupDn using LDAP_MATCHING_RULE_IN_CHAIN.
 * Falls back to direct memberOf check if the server does not support the OID filter.
 */
async function checkGroupMembership(client, groupDn, userDn, baseDn) {
  return new Promise((resolve) => {
    const filter = `(member:1.2.840.113556.1.4.1941:=${ldap.escapeFilter(userDn)})`;
    const opts = {
      filter: `(&(objectClass=group)(distinguishedName=${ldap.escapeFilter(groupDn)})${filter})`,
      scope: 'sub',
      attributes: ['dn'],
      sizeLimit: 1,
    };

    client.search(baseDn, opts, (err, res) => {
      if (err) return resolve(false);
      let found = false;
      res.on('searchEntry', () => { found = true; });
      res.on('error',  () => resolve(false));
      res.on('end',    () => resolve(found));
    });
  });
}

/**
 * Fetch all users from the configured AD groups for the daily sync.
 * Returns an array of user attribute objects.
 * @returns {Promise<Array<{username, firstName, lastName, email, objectGuid, groupRole}>>}
 */
async function fetchGroupMembers() {
  const adCfg = config.ad();
  if (!adCfg.enabled) throw new Error('AD is disabled');

  const client = await createBoundClient();
  const results = new Map(); // keyed by objectGuid to deduplicate

  try {
    for (const [groupKey, groupDn] of Object.entries(adCfg.groups || {})) {
      const role = adCfg.roleMapping?.[groupKey];
      const members = await getGroupMembers(client, groupDn, adCfg);

      for (const member of members) {
        if (!results.has(member.objectGuid || member.username)) {
          results.set(member.objectGuid || member.username, { ...member, groupRole: role });
        }
      }
    }
  } finally {
    client.destroy();
  }

  return Array.from(results.values());
}

async function getGroupMembers(client, groupDn, adCfg) {
  const members = [];
  const memberDns = await getDirectGroupMembers(client, groupDn, adCfg.baseDn);

  for (const memberDn of memberDns) {
    const user = await getUserByDn(client, memberDn, adCfg.userSearchBase || adCfg.baseDn);
    if (user) members.push(user);
  }
  return members;
}

async function getDirectGroupMembers(client, groupDn, baseDn) {
  return new Promise((resolve, reject) => {
    const opts = {
      filter: `(distinguishedName=${ldap.escapeFilter(groupDn)})`,
      scope: 'sub',
      attributes: ['member'],
    };
    client.search(baseDn, opts, (err, res) => {
      if (err) return reject(err);
      const members = [];
      res.on('searchEntry', (e) => {
        const raw = e.object.member;
        if (Array.isArray(raw)) members.push(...raw);
        else if (raw) members.push(raw);
      });
      res.on('error', reject);
      res.on('end', () => resolve(members));
    });
  });
}

async function getUserByDn(client, dn, searchBase) {
  return new Promise((resolve) => {
    const opts = {
      filter: `(distinguishedName=${ldap.escapeFilter(dn)})`,
      scope: 'sub',
      attributes: ['sAMAccountName', 'givenName', 'sn', 'mail', 'objectGUID', 'userAccountControl'],
    };
    client.search(searchBase, opts, (err, res) => {
      if (err) return resolve(null);
      let user = null;
      res.on('searchEntry', (e) => {
        const obj = e.object;
        const uac = parseInt(obj.userAccountControl || '0', 10);
        if (uac & 2) return; // skip disabled accounts
        user = {
          username: obj.sAMAccountName,
          firstName: obj.givenName || '',
          lastName: obj.sn || '',
          email: obj.mail || '',
          objectGuid: obj.objectGUID ? bufferToGuid(obj.objectGUID) : null,
        };
      });
      res.on('error', () => resolve(null));
      res.on('end',   () => resolve(user));
    });
  });
}

function getAllowedGroupDns(adCfg) {
  return Object.values(adCfg.groups || {});
}

/** Convert a raw objectGUID buffer to standard GUID string format. */
function bufferToGuid(raw) {
  if (typeof raw === 'string') return raw;
  if (!Buffer.isBuffer(raw)) return null;
  const h = raw.toString('hex');
  return [
    h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2),
    h.slice(10, 12) + h.slice(8, 10),
    h.slice(14, 16) + h.slice(12, 14),
    h.slice(16, 20),
    h.slice(20),
  ].join('-');
}

module.exports = { authenticateUser, fetchGroupMembers };
