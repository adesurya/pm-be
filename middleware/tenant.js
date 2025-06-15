// middleware/tenant.js
const { getTenantDB, initializeTenantModels } = require('../config/database');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

/**
 * Middleware to identify and load tenant based on domain
 */
const identifyTenant = async (req, res, next) => {
  try {
    const host = req.get('host');
    
    if (!host) {
      return res.status(400).json({
        success: false,
        message: 'Host header is required'
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
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Check if tenant is active
    if (!tenant.isActive()) {
      return res.status(403).json({
        success: false,
        message: 'Tenant is not active',
        code: 'TENANT_INACTIVE'
      });
    }

    // Check if trial has expired
    if (tenant.isTrialExpired()) {
      return res.status(402).json({
        success: false,
        message: 'Trial period has expired',
        code: 'TRIAL_EXPIRED'
      });
    }

    // Store tenant info in request
    req.tenant = tenant;
    req.tenantId = tenant.id;

    // Update last activity
    tenant.last_activity = new Date();
    await tenant.save();

    logger.info(`Tenant identified: ${tenant.name} (${tenant.domain})`);
    next();

  } catch (error) {
    logger.error('Error identifying tenant:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
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
        message: 'Tenant ID is required'
      });
    }

    // Get tenant database connection
    const tenantDB = await getTenantDB(req.tenantId);
    
    // Initialize models for this tenant
    const models = await initializeTenantModels(tenantDB);

    // Store in request for use in controllers
    req.db = tenantDB;
    req.models = models;

    logger.debug(`Tenant DB loaded for: ${req.tenantId}`);
    next();

  } catch (error) {
    logger.error('Error loading tenant database:', error);
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
          message: 'Tenant not found in request'
        });
      }

      let canProceed = true;
      let message = '';

      switch (resource) {
        case 'users':
          const userCount = await req.models.User.getActiveCount();
          canProceed = tenant.canCreateUser(userCount);
          message = `User limit exceeded. Maximum allowed: ${tenant.limits.max_users}`;
          break;

        case 'articles':
          const articleCount = await req.models.News.count();
          canProceed = tenant.canCreateArticle(articleCount);
          message = `Article limit exceeded. Maximum allowed: ${tenant.limits.max_articles}`;
          break;

        case 'categories':
          const categoryCount = await req.models.Category.count();
          canProceed = categoryCount < tenant.limits.max_categories;
          message = `Category limit exceeded. Maximum allowed: ${tenant.limits.max_categories}`;
          break;

        case 'tags':
          const tagCount = await req.models.Tag.count();
          canProceed = tagCount < tenant.limits.max_tags;
          message = `Tag limit exceeded. Maximum allowed: ${tenant.limits.max_tags}`;
          break;
      }

      if (!canProceed) {
        return res.status(402).json({
          success: false,
          message,
          code: 'LIMIT_EXCEEDED'
        });
      }

      next();

    } catch (error) {
      logger.error('Error checking tenant limits:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking limits'
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
        message: 'Tenant not found in request'
      });
    }

    if (!tenant.hasFeature(feature)) {
      return res.status(403).json({
        success: false,
        message: `Feature '${feature}' is not available in your plan`,
        code: 'FEATURE_NOT_AVAILABLE'
      });
    }

    next();
  };
};

/**
 * Middleware for API endpoints that need tenant context
 */
const tenantRequired = [identifyTenant, loadTenantDB];

/**
 * Middleware for admin endpoints
 */
const adminTenantRequired = [identifyTenant];

module.exports = {
  identifyTenant,
  loadTenantDB,
  checkTenantLimits,
  requireFeature,
  tenantRequired,
  adminTenantRequired
};