// controllers/tenantManagementController.js
const { validationResult } = require('express-validator');
const TenantAutomationService = require('../services/tenantAutomationService');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

const tenantAutomation = new TenantAutomationService();

/**
 * Create new tenant with automatic provisioning
 */
const createTenant = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      name,
      domain,
      subdomain,
      contact_email,
      contact_name,
      plan = 'trial'
    } = req.body;

    // Check if domain already exists
    const existingTenant = await Tenant.findOne({
      where: {
        $or: [
          { domain },
          { subdomain }
        ]
      }
    });

    if (existingTenant) {
      return res.status(409).json({
        success: false,
        message: 'Domain or subdomain already exists',
        code: 'DOMAIN_EXISTS'
      });
    }

    // Start provisioning process
    logger.info(`Starting tenant provisioning for: ${domain}`);

    const provisioningResult = await tenantAutomation.provisionTenant({
      name,
      domain,
      subdomain,
      contact_email,
      contact_name,
      plan
    });

    // Update tenant status to active
    await provisioningResult.tenant.update({ status: 'active' });

    // Log successful provisioning
    logger.audit('tenant_created', {
      tenant_id: provisioningResult.tenant.id,
      domain,
      plan,
      created_by: req.currentUser?.id
    });

    res.status(201).json({
      success: true,
      message: 'Tenant created and provisioned successfully',
      data: {
        tenant: provisioningResult.tenant,
        setup_details: provisioningResult.setup_details,
        access_info: {
          domain: domain,
          admin_panel: `https://${domain}/admin`,
          api_endpoint: `https://${domain}/api`
        }
      }
    });

  } catch (error) {
    logger.error('Create tenant error:', error);
    
    // Return appropriate error message
    if (error.message.includes('DNS')) {
      return res.status(400).json({
        success: false,
        message: 'DNS configuration failed. Please verify domain ownership.',
        code: 'DNS_ERROR'
      });
    }
    
    if (error.message.includes('SSL')) {
      return res.status(400).json({
        success: false,
        message: 'SSL certificate generation failed. Please try again.',
        code: 'SSL_ERROR'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update tenant'
    });
  }
};

/**
 * Update tenant domain (with automatic reconfiguration)
 */
const updateTenantDomain = async (req, res) => {
  try {
    const tenantId = req.params.id;
    const { new_domain } = req.body;

    const tenant = await Tenant.findByPk(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Check if new domain is already used
    const existingTenant = await Tenant.findOne({
      where: {
        domain: new_domain,
        id: { [Op.ne]: tenantId }
      }
    });

    if (existingTenant) {
      return res.status(409).json({
        success: false,
        message: 'Domain already exists',
        code: 'DOMAIN_EXISTS'
      });
    }

    const oldDomain = tenant.domain;
    
    // Update domain with automatic reconfiguration
    await tenantAutomation.updateTenantDomain(tenantId, new_domain);

    logger.audit('tenant_domain_updated', {
      tenant_id: tenantId,
      old_domain: oldDomain,
      new_domain: new_domain,
      updated_by: req.currentUser?.id
    });

    res.json({
      success: true,
      message: 'Tenant domain updated successfully',
      data: {
        old_domain: oldDomain,
        new_domain: new_domain,
        tenant: await Tenant.findByPk(tenantId)
      }
    });

  } catch (error) {
    logger.error('Update tenant domain error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update tenant domain'
    });
  }
};

/**
 * Delete tenant (complete deprovisioning)
 */
const deleteTenant = async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    const tenant = await Tenant.findByPk(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Store tenant info for logging
    const tenantInfo = {
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain
    };

    // Deprovision tenant (removes all resources)
    await tenantAutomation.deprovisionTenant(tenantId);

    logger.audit('tenant_deleted', {
      tenant_info: tenantInfo,
      deleted_by: req.currentUser?.id
    });

    res.json({
      success: true,
      message: 'Tenant deleted and deprovisioned successfully'
    });

  } catch (error) {
    logger.error('Delete tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tenant'
    });
  }
};

/**
 * Get tenant provisioning status
 */
const getTenantStatus = async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    const tenant = await Tenant.findByPk(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Check various service statuses
    const status = {
      tenant_status: tenant.status,
      domain: tenant.domain,
      ssl_certificate: await checkSSLCertificate(tenant.domain),
      nginx_config: await checkNginxConfig(tenant.domain),
      dns_resolution: await checkDNSResolution(tenant.domain),
      health_check: await checkTenantHealth(tenant.domain),
      database: await checkTenantDatabase(tenant.id)
    };

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          domain: tenant.domain,
          status: tenant.status
        },
        services: status
      }
    });

  } catch (error) {
    logger.error('Get tenant status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tenant status'
    });
  }
};

/**
 * Bulk operations on tenants
 */
const bulkTenantOperations = async (req, res) => {
  try {
    const { action, tenant_ids } = req.body;

    if (!Array.isArray(tenant_ids) || tenant_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tenant IDs array is required'
      });
    }

    const results = [];
    
    for (const tenantId of tenant_ids) {
      try {
        let result;
        
        switch (action) {
          case 'suspend':
            result = await Tenant.update(
              { status: 'suspended' },
              { where: { id: tenantId } }
            );
            break;
            
          case 'activate':
            result = await Tenant.update(
              { status: 'active' },
              { where: { id: tenantId } }
            );
            break;
            
          case 'delete':
            await tenantAutomation.deprovisionTenant(tenantId);
            result = { success: true };
            break;
            
          default:
            throw new Error('Invalid bulk action');
        }
        
        results.push({
          tenant_id: tenantId,
          success: true,
          result
        });
        
      } catch (error) {
        results.push({
          tenant_id: tenantId,
          success: false,
          error: error.message
        });
      }
    }

    logger.audit('bulk_tenant_operation', {
      action,
      tenant_ids,
      results,
      performed_by: req.currentUser?.id
    });

    res.json({
      success: true,
      message: `Bulk ${action} operation completed`,
      data: {
        results
      }
    });

  } catch (error) {
    logger.error('Bulk tenant operations error:', error);
    res.status(500).json({
      success: false,
      message: 'Bulk operation failed'
    });
  }
};

/**
 * Get tenant analytics and usage statistics
 */
const getTenantAnalytics = async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    const tenant = await Tenant.findByPk(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Get tenant database connection
    const { getTenantDB, initializeTenantModels } = require('../config/database');
    const tenantDB = await getTenantDB(tenantId);
    const models = await initializeTenantModels(tenantDB);

    // Gather analytics data
    const [
      userCount,
      articleCount,
      categoryCount,
      tagCount,
      publishedArticles,
      draftArticles,
      totalViews,
      recentActivity
    ] = await Promise.all([
      models.User.count(),
      models.News.count(),
      models.Category.count(),
      models.Tag.count(),
      models.News.count({ where: { status: 'published' } }),
      models.News.count({ where: { status: 'draft' } }),
      models.News.sum('views_count') || 0,
      models.News.count({
        where: {
          created_at: {
            [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        }
      })
    ]);

    const analytics = {
      usage: {
        users: userCount,
        articles: articleCount,
        categories: categoryCount,
        tags: tagCount
      },
      limits: tenant.limits,
      usage_percentage: {
        users: Math.round((userCount / tenant.limits.max_users) * 100),
        articles: Math.round((articleCount / tenant.limits.max_articles) * 100),
        categories: Math.round((categoryCount / tenant.limits.max_categories) * 100),
        tags: Math.round((tagCount / tenant.limits.max_tags) * 100)
      },
      content_stats: {
        published_articles: publishedArticles,
        draft_articles: draftArticles,
        total_views: totalViews,
        recent_activity: recentActivity
      },
      plan_info: {
        current_plan: tenant.plan,
        status: tenant.status,
        trial_ends_at: tenant.trial_ends_at
      }
    };

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          domain: tenant.domain
        },
        analytics
      }
    });

  } catch (error) {
    logger.error('Get tenant analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tenant analytics'
    });
  }
};

// Helper functions for status checks
const checkSSLCertificate = async (domain) => {
  try {
    const { execSync } = require('child_process');
    const result = execSync(`openssl s_client -connect ${domain}:443 -servername ${domain} < /dev/null 2>/dev/null | openssl x509 -noout -dates`, 
      { encoding: 'utf8', timeout: 10000 });
    
    return {
      status: 'valid',
      details: result.trim()
    };
  } catch (error) {
    return {
      status: 'invalid',
      error: error.message
    };
  }
};

const checkNginxConfig = async (domain) => {
  try {
    const fs = require('fs').promises;
    const configPath = `/etc/nginx/sites-enabled/${domain}.conf`;
    
    await fs.access(configPath);
    return {
      status: 'configured',
      config_file: configPath
    };
  } catch (error) {
    return {
      status: 'not_configured',
      error: 'Configuration file not found'
    };
  }
};

const checkDNSResolution = async (domain) => {
  try {
    const dns = require('dns').promises;
    const addresses = await dns.resolve4(domain);
    
    return {
      status: 'resolved',
      addresses
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message
    };
  }
};

const checkTenantHealth = async (domain) => {
  try {
    const axios = require('axios');
    const response = await axios.get(`https://${domain}/health`, {
      timeout: 10000,
      validateStatus: (status) => status === 200
    });
    
    return {
      status: 'healthy',
      response_time: response.headers['x-response-time'] || 'unknown'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
};

const checkTenantDatabase = async (tenantId) => {
  try {
    const { getTenantDB } = require('../config/database');
    const tenantDB = await getTenantDB(tenantId);
    
    await tenantDB.authenticate();
    
    return {
      status: 'connected',
      database: `news_cms_tenant_${tenantId}`
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message
    };
  }
};

/**
 * Get all tenants (Super Admin only)
 */
const getAllTenants = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      plan,
      search,
      sort = 'created_at',
      order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    // Build where clause
    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (plan) {
      where.plan = plan;
    }
    
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { domain: { [Op.like]: `%${search}%` } },
        { contact_email: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: tenants } = await Tenant.findAndCountAll({
      where,
      order: [[sort, order.toUpperCase()]],
      limit: pageLimit,
      offset,
      attributes: { exclude: ['database_name'] } // Don't expose internal details
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        tenants,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: count,
          items_per_page: pageLimit,
          has_next_page: page < totalPages,
          has_prev_page: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get all tenants error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tenants'
    });
  }
};

/**
 * Get single tenant details
 */
const getTenantById = async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    const tenant = await Tenant.findByPk(tenantId, {
      attributes: { exclude: ['database_name'] }
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        tenant
      }
    });

  } catch (error) {
    logger.error('Get tenant by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tenant'
    });
  }
};

/**
 * Update tenant information
 */
const updateTenant = async (req, res) => {
  try {
    const tenantId = req.params.id;
    const {
      name,
      contact_email,
      contact_name,
      status,
      plan,
      settings,
      limits
    } = req.body;

    const tenant = await Tenant.findByPk(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (contact_email !== undefined) updateData.contact_email = contact_email;
    if (contact_name !== undefined) updateData.contact_name = contact_name;
    if (status !== undefined) updateData.status = status;
    if (plan !== undefined) updateData.plan = plan;
    if (settings !== undefined) updateData.settings = { ...tenant.settings, ...settings };
    if (limits !== undefined) updateData.limits = { ...tenant.limits, ...limits };

    await tenant.update(updateData);

    logger.audit('tenant_updated', {
      tenant_id: tenantId,
      changes: updateData,
      updated_by: req.currentUser?.id
    });

    res.json({
      success: true,
      message: 'Tenant updated successfully',
      data: {
        tenant
      }
    });

  } catch (error) {
    logger.error('Update tenant error:', error);
    res.status(500).json({
      success: false
    })
  }
}

module.exports = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  updateTenantDomain,
  deleteTenant,
  getTenantStatus,
  bulkTenantOperations,
  getTenantAnalytics
};

