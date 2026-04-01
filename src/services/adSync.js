'use strict';

/**
 * Active Directory synchronisation service.
 *
 * Fetches all members of the configured AD groups, then:
 *   - Creates new user records for AD users not yet in the DB.
 *   - Updates name / email for existing AD users.
 *   - Deactivates users who are no longer members of any allowed group.
 *   - Assigns roles based on group-to-role mapping in ad.config.json.
 *
 * Results are written to the ad_sync_log table.
 */

const prisma = require('../db/prisma');
const ldapService = require('./ldap');
const config = require('../config');
const logger = require('../logger');

async function runSync({ triggeredBy = 'SCHEDULER' } = {}) {
  const adCfg = config.ad();
  if (!adCfg.enabled) {
    logger.info('AD sync skipped – AD integration is disabled');
    return { skipped: true };
  }

  const startedAt = new Date();
  const logEntry = await prisma.adSyncLog.create({
    data: { startedAt, success: false },
  });

  logger.info('AD sync started', { logId: logEntry.id, triggeredBy });

  let usersAdded = 0;
  let usersUpdated = 0;
  let usersDeactivated = 0;

  try {
    // Fetch all group members from AD
    const adUsers = await ldapService.fetchGroupMembers();
    const adUsernames = new Set(adUsers.map((u) => u.username.toLowerCase()));

    // Load existing AD (non-local) users from DB
    const dbUsers = await prisma.user.findMany({
      where: { isLocal: false },
      include: { roles: { include: { role: true } }, profile: true },
    });

    const dbByUsername = new Map(dbUsers.map((u) => [u.username.toLowerCase(), u]));
    const dbByGuid = new Map(
      dbUsers.filter((u) => u.adObjectGuid).map((u) => [u.adObjectGuid, u])
    );

    // Load role records
    const roles = await prisma.role.findMany();
    const roleByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));

    for (const adUser of adUsers) {
      // Find existing DB user by GUID (preferred – stable across renames) or username
      const existing = (adUser.objectGuid && dbByGuid.get(adUser.objectGuid))
        || dbByUsername.get(adUser.username.toLowerCase());

      const roleName = (adUser.groupRole || 'employee').toLowerCase();
      const role = roleByName.get(roleName) || roleByName.get('employee');

      if (!existing) {
        // Create new user
        await prisma.user.create({
          data: {
            username: adUser.username.toLowerCase(),
            firstName: adUser.firstName,
            lastName: adUser.lastName,
            email: adUser.email,
            isLocal: false,
            isActive: true,
            adObjectGuid: adUser.objectGuid,
            profile: { create: { language: 'en' } },
            roles: role ? { create: { roleId: role.id } } : undefined,
          },
        });
        usersAdded++;
        logger.debug('AD sync: user created', { username: adUser.username });
      } else {
        // Update existing user
        const updates = {};
        if (existing.firstName !== adUser.firstName) updates.firstName = adUser.firstName;
        if (existing.lastName  !== adUser.lastName)  updates.lastName  = adUser.lastName;
        if (existing.email     !== adUser.email)     updates.email     = adUser.email;
        if (!existing.isActive) updates.isActive = true;
        if (!existing.adObjectGuid && adUser.objectGuid) updates.adObjectGuid = adUser.objectGuid;

        if (Object.keys(updates).length > 0) {
          await prisma.user.update({ where: { id: existing.id }, data: updates });
          usersUpdated++;
        }

        // Sync role (only if not manually overridden)
        if (role) {
          const hasRole = existing.roles.some((ur) => ur.role.id === role.id);
          if (!hasRole) {
            await prisma.userRole.upsert({
              where: { userId_roleId: { userId: existing.id, roleId: role.id } },
              create: { userId: existing.id, roleId: role.id },
              update: {},
            });
          }
        }
      }
    }

    // Deactivate AD users no longer in any group
    for (const dbUser of dbUsers) {
      if (!adUsernames.has(dbUser.username.toLowerCase()) && dbUser.isActive) {
        await prisma.user.update({ where: { id: dbUser.id }, data: { isActive: false } });
        usersDeactivated++;
        logger.debug('AD sync: user deactivated', { username: dbUser.username });
      }
    }

    await prisma.adSyncLog.update({
      where: { id: logEntry.id },
      data: {
        completedAt: new Date(),
        usersAdded,
        usersUpdated,
        usersDeactivated,
        success: true,
      },
    });

    logger.info('AD sync completed', { usersAdded, usersUpdated, usersDeactivated });
    return { usersAdded, usersUpdated, usersDeactivated };
  } catch (err) {
    await prisma.adSyncLog.update({
      where: { id: logEntry.id },
      data: {
        completedAt: new Date(),
        errorMessage: err.message,
        success: false,
      },
    });
    logger.error('AD sync failed', { message: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = { runSync };
