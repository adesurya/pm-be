// routes/index.js - Main API routes (FIXED VERSION)
const express = require('express');
const router = express.Router();

// Import middleware
const { provideCsrfToken } = require('../middleware/csrf');

// CSRF token endpoint
router.get('/csrf-token', (req, res) => {
  try {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    
    res.json({
      success: true,
      csrfToken: token,
      message: 'CSRF token generated'
    });
  } catch (error) {
    console.error('Error providing CSRF token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CSRF token'
    });
  }
});

// API Documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API Documentation',
    version: '1.0.0-optimized',
    documentation: {
      master_admin: {
        base_url: '/api/master',
        endpoints: [
          {
            method: 'GET',
            path: '/status',
            description: 'Check master admin setup status',
            auth: 'none'
          },
          {
            method: 'POST',
            path: '/setup',
            description: 'Setup first master admin',
            auth: 'master_key',
            body: {
              email: 'string',
              password: 'string',
              name: 'string',
              master_key: 'string'
            }
          },
          {
            method: 'POST',
            path: '/login',
            description: 'Master admin login',
            auth: 'none',
            body: {
              email: 'string',
              password: 'string'
            }
          },
          {
            method: 'GET',
            path: '/profile',
            description: 'Get master admin profile',
            auth: 'bearer_token'
          }
        ]
      },
      tenant_management: {
        base_url: '/api/tenant-management',
        auth: 'bearer_token (master admin)',
        endpoints: [
          {
            method: 'GET',
            path: '/',
            description: 'List all tenants',
            query: ['page', 'limit', 'search']
          },
          {
            method: 'POST',
            path: '/',
            description: 'Create new tenant',
            body: {
              name: 'string',
              domain: 'string',
              contact_email: 'string',
              contact_name: 'string',
              plan: 'trial|basic|professional|enterprise'
            }
          },
          {
            method: 'GET',
            path: '/:id',
            description: 'Get tenant details'
          },
          {
            method: 'PUT',
            path: '/:id',
            description: 'Update tenant'
          },
          {
            method: 'DELETE',
            path: '/:id',
            description: 'Delete tenant'
          },
          {
            method: 'GET',
            path: '/:id/analytics',
            description: 'Get tenant analytics'
          },
          {
            method: 'POST',
            path: '/:id/seed',
            description: 'Seed sample data for tenant'
          },
          {
            method: 'GET',
            path: '/:id/status',
            description: 'Get tenant system status'
          }
        ]
      },
      tenant_api: {
        note: 'Requires Host header with tenant domain',
        base_url: '/api',
        endpoints: [
          {
            method: 'POST',
            path: '/auth/login',
            description: 'Tenant user login',
            headers: { 'Host': 'yourdomain.localhost' }
          },
          {
            method: 'GET',
            path: '/news',
            description: 'Get news articles',
            headers: { 'Host': 'yourdomain.localhost' }
          },
          {
            method: 'GET',
            path: '/categories',
            description: 'Get categories',
            headers: { 'Host': 'yourdomain.localhost' }
          }
        ]
      }
    },
    examples: {
      master_setup: {
        url: 'POST /api/master/setup',
        body: {
          email: 'admin@system.com',
          password: 'MasterAdmin123!',
          name: 'System Administrator',
          master_key: 'your-master-setup-key-2024'
        }
      },
      tenant_login: {
        url: 'POST /api/auth/login',
        headers: { 'Host': 'haluanco.localhost' },
        body: {
          email: 'admin@test.localhost',
          password: 'generated_password'
        }
      }
    }
  });
});

// Load route modules with error handling
const loadRoute = (routePath, routeName) => {
  try {
    return require(routePath);
  } catch (error) {
    console.warn(`⚠️  Failed to load ${routeName} routes:`, error.message);
    
    // Return a minimal router that explains the issue
    const fallbackRouter = express.Router();
    fallbackRouter.use('*', (req, res) => {
      res.status(503).json({
        success: false,
        message: `${routeName} service temporarily unavailable`,
        error: `Failed to load ${routeName} routes: ${error.message}`,
        code: 'SERVICE_UNAVAILABLE'
      });
    });
    return fallbackRouter;
  }
};

// Mount route modules with fallbacks
try {
  const authRoutes = loadRoute('./auth', 'auth');
  router.use('/auth', authRoutes);
  console.log('✅ Auth routes mounted on /api/auth');
} catch (error) {
  console.error('Failed to mount auth routes:', error);
}

try {
  const newsRoutes = loadRoute('./news', 'news');
  router.use('/news', newsRoutes);
  console.log('✅ News routes mounted on /api/news');
} catch (error) {
  console.error('Failed to mount news routes:', error);
}

try {
  const categoryRoutes = loadRoute('./categories', 'categories');
  router.use('/categories', categoryRoutes);
  console.log('✅ Category routes mounted on /api/categories');
} catch (error) {
  console.error('Failed to mount category routes:', error);
}

try {
  const tagRoutes = loadRoute('./tags', 'tags');
  router.use('/tags', tagRoutes);
  console.log('✅ Tag routes mounted on /api/tags');
} catch (error) {
  console.error('Failed to mount tag routes:', error);
}

try {
  const userRoutes = loadRoute('./users', 'users');
  router.use('/users', userRoutes);
  console.log('✅ User routes mounted on /api/users');
} catch (error) {
  console.error('Failed to mount user routes:', error);
}

// API information endpoint
router.get('/', (req, res) => {
  const availableRoutes = [];
  
  // Check which routes are actually available
  if (req.tenant) {
    availableRoutes.push(
      'POST /api/auth/login - User login',
      'GET /api/auth/profile - Get user profile',
      'GET /api/news - Get news articles',
      'POST /api/news - Create news article',
      'GET /api/categories - Get categories',
      'POST /api/categories - Create category',
      'GET /api/tags - Get tags'
    );
  }

  res.json({
    success: true,
    message: 'News CMS SaaS API',
    version: '1.0.0-optimized',
    tenant: req.tenant ? {
      id: req.tenant.id,
      name: req.tenant.name,
      domain: req.tenant.domain,
      plan: req.tenant.plan
    } : null,
    available_endpoints: availableRoutes.length > 0 ? availableRoutes : [
      'GET /api/csrf-token - Get CSRF token',
      'Use Host header to access tenant-specific endpoints'
    ],
    note: req.tenant ? 
      'Tenant context detected - use Bearer token for authentication' :
      'Add Host header (e.g., "Host: yourdomain.localhost") to access tenant endpoints'
  });
});

module.exports = router;