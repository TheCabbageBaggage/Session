'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /profile – user profile settings (placeholder for M2)
router.get('/', (req, res) => {
  res.render('profile/index', {
    title: req.t('nav.profile'),
  });
});

module.exports = router;
