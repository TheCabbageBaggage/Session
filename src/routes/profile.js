'use strict';

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const userService = require('../services/userService');
const logger = require('../logger');

router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /profile
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.render('profile/index', {
    title: req.t('nav.profile'),
    error: req.query.error || null,
    success: req.query.success ? req.t('profile.saved') : null,
  });
});

// ---------------------------------------------------------------------------
// POST /profile – save company, cost centre, language
// ---------------------------------------------------------------------------
router.post(
  '/',
  [
    body('company').trim().optional().isLength({ max: 200 }),
    body('costCentre').trim().optional().isLength({ max: 100 }),
    body('language').isIn(['en', 'de']).withMessage('Invalid language'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('profile/index', {
        title: req.t('nav.profile'),
        error: errors.array()[0].msg,
        success: null,
      });
    }

    const { company, costCentre, language } = req.body;

    try {
      await userService.updateProfile(req.user.id, { company, costCentre, language });
      logger.info('User updated profile', { userId: req.user.id });
      res.redirect('/profile?success=1');
    } catch (err) {
      res.status(500).render('profile/index', {
        title: req.t('nav.profile'),
        error: req.t('errors.unexpected'),
        success: null,
      });
    }
  }
);

module.exports = router;
