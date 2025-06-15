// routes/index.js
const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const newsRoutes = require('./news');
const categoryRoutes = require('./categories');
const tagRoutes = require('./tags');
const userRoutes = require('./users');
const tenantRoutes = require('./tenants');

// Import middleware
const { csrfTokenEndpoint } = require('../middleware/csrf');

// CSRF token endpoint
router.get('/csrf-token', csrfTokenEndpoint);

// Mount route modules
router.use('/auth', authRoutes);
router.use('/news', newsRoutes);
router.use('/categories', categoryRoutes);
router.use('/tags', tagRoutes);
router.use('/users', userRoutes);
router.use('/tenants', tenantRoutes);

// API information endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API',
    version: '1.0.0',
    tenant: {
      id: req.tenant?.id,
      name: req.tenant?.name,
      domain: req.tenant?.domain,
      plan: req.tenant?.plan
    },
    endpoints: [
      'GET /api/csrf-token - Get CSRF token',
      'POST /api/auth/login - User login',
      'POST /api/auth/register - User registration',
      'GET /api/news - Get news articles',
      'GET /api/categories - Get categories',
      'GET /api/tags - Get tags',
      'GET /api/users - Get users (admin only)'
    ]
  });
});

module.exports = router;