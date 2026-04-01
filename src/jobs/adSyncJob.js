'use strict';

const cron = require('node-cron');
const adSync = require('../services/adSync');
const config = require('../config');
const logger = require('../logger');

let scheduledTask = null;

/**
 * Start the daily AD sync cron job.
 * The schedule is read from ad.config.json (syncSchedule, cron format).
 * Default: "0 2 * * *" (02:00 daily).
 */
function start() {
  const adCfg = config.ad();
  if (!adCfg.enabled) {
    logger.info('AD sync job not started – AD integration is disabled');
    return;
  }

  const schedule = adCfg.sync?.cronSchedule || '0 2 * * *';

  if (!cron.validate(schedule)) {
    logger.error('Invalid AD sync cron schedule', { schedule });
    return;
  }

  scheduledTask = cron.schedule(schedule, async () => {
    logger.info('AD sync job triggered by scheduler');
    try {
      await adSync.runSync({ triggeredBy: 'SCHEDULER' });
    } catch (err) {
      logger.error('Scheduled AD sync failed', { message: err.message });
    }
  });

  logger.info('AD sync job scheduled', { schedule });
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('AD sync job stopped');
  }
}

module.exports = { start, stop };
