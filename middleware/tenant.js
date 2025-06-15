// middleware/tenant.js
const { getTenantDB, initializeTenantModels } = require('../config/database');
const Tenant = require('../models/Tenant');

/**
 * Middleware to identify and load tenant based on domain
 */
const identifyTenant = async (req, res, next) => {
  try {
    const host = req.get('host');
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: 'Host header is required',
        code: 'NO_HOST_HEADER'
      });
    }

    // Remove port if present
    const domain = host.split(':')[0];
    
    // Check if it's a subdomain (e.g., tenant1.yourdomain.com)
    const parts = domain.split('.');
    let tenant = null;

    if (parts.length >= 3) {
      // Subdomain approach
      const subdomain = parts[0];
      tenant = await Tenant.findBySubdomain(subdomain);
    } else {
      // Custom domain approach
      tenant = await Tenant.findByDomain(domain);
    }

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found for domain: ' + domain,
        code: 'TENANT_NOT_FOUND',
        domain: domain,
        help: {
          message: 'This domain is not configured as a tenant',
          steps: [
            'Verify the domain is correct',
            'Check if tenant exists in master admin panel',
            'Ensure DNS is properly configured'
          ]
        }
      });
    }

    // Check if tenant is active
    if (!tenant.isActive()) {
      return res.status(403).json({
        success: false,
        message: 'Tenant is not active',
        code: 'TENANT_INACTIVE',
        tenant_status: tenant.status
      });
    }

    // Check if trial has expired
    if (tenant.isTrialExpired()) {
      return res.status(402).json({
        success: false,
        message: 'Trial period has expired',
        code: 'TRIAL_EXPIRED',
        trial_ends_at: tenant.trial_ends_at
      });
    }

    // Store tenant info in request
    req.tenant = tenant;
    req.tenantId = tenant.id;

    // Update last activity
    try {
      tenant.last_activity = new Date();
      await tenant.save();
    } catch (error) {
      // Don't fail if we can't update last activity
      console.warn('Failed to update tenant last activity:', error);
    }

    console.log(`Tenant identified: ${tenant.name} (${tenant.domain})`);
    next();

  } catch (error) {
    console.error('Error identifying tenant:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while identifying tenant',
      code: 'TENANT_ERROR'
    });
  }
};

/**
 * Middleware to load tenant database connection and models
 */
const loadTenantDB = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
        code: 'NO_TENANT_ID'
      });
    }

    // Get tenant database connection
    const tenantDB = await getTenantDB(req.tenantId);
    
    // Initialize models for this tenant
    const models = await initializeTenantModels(tenantDB);

    // Store in request for use in controllers
    req.db = tenantDB;
    req.models = models;

    console.log(`Tenant DB loaded for: ${req.tenantId}`);
    next();

  } catch (error) {
    console.error('Error loading tenant database:', error);
    
    // Provide specific error messages
    if (error.code === 'ER_BAD_DB_ERROR') {
      return res.status(500).json({
        success: false,
        message: 'Tenant database not found',
        code: 'TENANT_DB_NOT_FOUND',
        help: 'The tenant database may not be properly initialized'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Database connection error',
      code: 'DB_CONNECTION_ERROR'
    });
  }
};

/**
 * Middleware to check tenant limits
 */
const checkTenantLimits = (resource) => {
  return async (req, res, next) => {
    try {
      const tenant = req.tenant;
      
      if (!tenant) {
        return res.status(400).json({
          success: false,
          message: 'Tenant not found in request',
          code: 'NO_TENANT_CONTEXT'
        });
      }

      let canProceed = true;
      let message = '';
      let currentCount = 0;
      let limit = 0;

      switch (resource) {
        case 'users':
          currentCount = await req.models.User.getActiveCount();
          limit = tenant.limits.max_users;
          canProceed = tenant.canCreateUser(currentCount);
          message = `User limit exceeded. Current: ${currentCount}, Maximum: ${limit}`;
          break;

        case 'articles':
          currentCount = await req.models.News.count();
          limit = tenant.limits.max_articles;
          canProceed = tenant.canCreateArticle(currentCount);
          message = `Article limit exceeded. Current: ${currentCount}, Maximum: ${limit}`;
          break;

        case 'categories':
          currentCount = await req.models.Category.count();
          limit = tenant.limits.max_categories;
          canProceed = currentCount < limit;
          message = `Category limit exceeded. Current: ${currentCount}, Maximum: ${limit}`;
          break;

        case 'tags':
          currentCount = await req.models.Tag.count();
          limit = tenant.limits.max_tags;
          canProceed = currentCount < limit;
          message = `Tag limit exceeded. Current: ${currentCount}, Maximum: ${limit}`;
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid resource type for limit check',
            code: 'INVALID_RESOURCE'
          });
      }

      if (!canProceed) {
        return res.status(402).json({
          success: false,
          message,
          code: 'LIMIT_EXCEEDED',
          usage: {
            current: currentCount,
            limit: limit,
            percentage: Math.round((currentCount / limit) * 100)
          },
          upgrade_info: {
            current_plan: tenant.plan,
            contact: 'Contact administrator to upgrade plan'
          }
        });
      }

      next();

    } catch (error) {
      console.error('Error checking tenant limits:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking resource limits',
        code: 'LIMIT_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware to check if tenant has specific feature
 */
const requireFeature = (feature) => {
  return (req, res, next) => {
    const tenant = req.tenant;
    
    if (!tenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant not found in request',
        code: 'NO_TENANT_CONTEXT'
      });
    }

    if (!tenant.hasFeature(feature)) {
      return res.status(403).json({
        success: false,
        message: `Feature '${feature}' is not available in your plan`,
        code: 'FEATURE_NOT_AVAILABLE',
        current_plan: tenant.plan,
        available_features: tenant.settings.features || {},
        upgrade_info: 'Contact administrator to upgrade plan'
      });
    }

    next();
  };
};

/**
 * Middleware to check tenant status
 */
const requireActiveTenant = (req, res, next) => {
  const tenant = req.tenant;
  
  if (!tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required',
      code: 'NO_TENANT_CONTEXT'
    });
  }

  if (tenant.status === 'suspended') {
    return res.status(403).json({
      success: false,
      message: 'Tenant account is suspended',
      code: 'TENANT_SUSPENDED',
      contact: 'Contact administrator for assistance'
    });
  }

  if (tenant.status === 'inactive') {
    return res.status(403).json({
      success: false,
      message: 'Tenant account is inactive',
      code: 'TENANT_INACTIVE'
    });
  }

  next();
};

/**
 * Middleware to add tenant info to response headers (for debugging)
 */
const addTenantHeaders = (req, res, next) => {
  if (req.tenant) {
    res.set({
      'X-Tenant-ID': req.tenant.id,
      'X-Tenant-Name': req.tenant.name,
      'X-Tenant-Plan': req.tenant.plan,
      'X-Tenant-Status': req.tenant.status
    });
  }
  
  next();
};

/**
 * Middleware to log tenant activity
 */
const logTenantActivity = (action) => {
  return (req, res, next) => {
    if (req.tenant && req.currentUser) {
      console.log(`Tenant Activity: ${action}`, {
        tenant_id: req.tenant.id,
        tenant_name: req.tenant.name,
        user_id: req.currentUser.id,
        user_email: req.currentUser.email,
        action: action,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        user_agent: req.get('User-Agent')
      });
    }
    
    next();
  };
};

/**
 * Middleware for API endpoints that need tenant context
 */
const tenantRequired = [identifyTenant, loadTenantDB, requireActiveTenant, addTenantHeaders];

/**
 * Middleware for admin endpoints (tenant context but no DB required)
 */
const adminTenantRequired = [identifyTenant, requireActiveTenant];

/**
 * Middleware for public endpoints (optional tenant context)
 */
const optionalTenant = async (req, res, next) => {
  try {
    const host = req.get('host');
    
    if (host) {
      const domain = host.split(':')[0];
      const parts = domain.split('.');
      let tenant = null;

      if (parts.length >= 3) {
        const subdomain = parts[0];
        tenant = await Tenant.findBySubdomain(subdomain);
      } else {
        tenant = await Tenant.findByDomain(domain);
      }

      if (tenant && tenant.isActive() && !tenant.isTrialExpired()) {
        req.tenant = tenant;
        req.tenantId = tenant.id;
        
        // Try to load tenant DB
        try {
          const tenantDB = await getTenantDB(req.tenantId);
          const models = await initializeTenantModels(tenantDB);
          req.db = tenantDB;
          req.models = models;
        } catch (error) {
          // Continue without tenant DB if it fails
          console.warn('Failed to load tenant DB in optional context:', error);
        }
      }
    }
    
    next();
  } catch (error) {
    // Continue without tenant context if identification fails
    console.warn('Failed to identify tenant in optional context:', error);
    next();
  }
};

/**
 * Development helper - bypass tenant checks
 */
const bypassTenant = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.BYPASS_TENANT === 'true') {
    console.warn('⚠️  BYPASSING TENANT CHECKS - DEVELOPMENT ONLY');
    
    // Create fake tenant for development
    req.tenant = {
      id: 'dev-tenant-id',
      name: 'Development Tenant',
      domain: 'localhost',
      plan: 'enterprise',
      status: 'active',
      limits: {
        max_users: 9999999,
        max_articles: 9999999,
        max_categories: 9999999,
        max_tags: 9999999
      },
      settings: {
        features: {
          analytics: true,
          seo: true,
          advanced_editor: true,
          api_access: true
        }
      },
      hasFeature: () => true,
      isActive: () => true,
      isTrialExpired: () => false,
      canCreateUser: () => true,
      canCreateArticle: () => true
    };
    
    req.tenantId = 'dev-tenant-id';
  }
  
  next();
};

module.exports = {
  identifyTenant,
  loadTenantDB,
  checkTenantLimits,
  requireFeature,
  requireActiveTenant,
  addTenantHeaders,
  logTenantActivity,
  tenantRequired,
  adminTenantRequired,
  optionalTenant,
  bypassTenant
};