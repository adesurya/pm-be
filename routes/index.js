// routes/index.js
const express = require('express');
const router = express.Router();

// Import route modules with error handling
const authRoutes = require('./auth');
const newsRoutes = require('./news');

// Import middleware
const { csrfTokenEndpoint } = require('../middleware/csrf');

// CSRF token endpoint
router.get('/csrf-token', csrfTokenEndpoint);

// Mount route modules
router.use('/auth', authRoutes);
router.use('/news', newsRoutes);

// Import optional routes with error handling
try {
  const categoryRoutes = require('./categories');
  router.use('/categories', categoryRoutes);
} catch (error) {
  console.warn('Categories routes not available:', error.message);
}

try {
  const tagRoutes = require('./tags');
  router.use('/tags', tagRoutes);
} catch (error) {
  console.warn('Tags routes not available:', error.message);
}

try {
  const userRoutes = require('./users');
  router.use('/users', userRoutes);
} catch (error) {
  console.warn('Users routes not available:', error.message);
}

try {
  const tenantRoutes = require('./tenants');
  router.use('/tenants', tenantRoutes);
} catch (error) {
  console.warn('Tenants routes not available:', error.message);
}

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
      'GET /api/categories - Get categories (if available)',
      'GET /api/tags - Get tags (if available)',
      'GET /api/users - Get users (admin only, if available)'
    ]
  });
});

module.exports = router;