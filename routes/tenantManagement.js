// routes/tenantManagement.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const { masterDB, createTenantDB, getTenantDB, initializeTenantModels } = require('../config/database');
const { authenticateMasterAdmin } = require('./masterAuth.js.bak');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  next();
};

// Validation rules
const createTenantValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2-100 characters'),
  body('domain')
    .trim()
    .matches(/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\.[a-zA-Z]{2,}$/)
    .withMessage('Valid domain is required'),
  body('contact_email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('contact_name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Contact name must be between 2-100 characters'),
  body('plan')
    .optional()
    .isIn(['trial', 'basic', 'professional', 'enterprise'])
    .withMessage('Invalid plan type')
];

/**
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    // Test database connection
    await masterDB.authenticate();
    
    res.json({
      success: true,
      message: 'Tenant management service is healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      message: 'Service unavailable',
      error: error.message
    });
  }
});

/**
 * Get all tenants (Master Admin only)
 */
router.get('/', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    
    const {
      page = 1,
      limit = 20,
      status,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    // Build where clause
    const where = {};
    if (status) where.status = status;
    if (search) {
      where[masterDB.Sequelize.Op.or] = [
        { name: { [masterDB.Sequelize.Op.like]: `%${search}%` } },
        { domain: { [masterDB.Sequelize.Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: tenants } = await Tenant.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: pageLimit,
      offset,
      attributes: { exclude: ['database_name'] }
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
          items_per_page: pageLimit
        }
      }
    });

  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tenants'
    });
  }
});

/**
 * Create new tenant (Master Admin only)
 */
router.post('/', 
  authenticateMasterAdmin,
  createTenantValidation,
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        name,
        domain,
        subdomain,
        contact_email,
        contact_name,
        plan = 'trial'
      } = req.body;

      // Check if domain already exists
      const Tenant = require('../models/Tenant');
      const existingTenant = await Tenant.findOne({
        where: {
          [masterDB.Sequelize.Op.or]: [
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

      console.log(`Creating tenant: ${name} (${domain})`);

      // Create tenant record
      const tenant = await Tenant.create({
        name,
        domain,
        subdomain,
        contact_email,
        contact_name,
        status: 'provisioning',
        plan
      });

      console.log(`✅ Tenant record created: ${tenant.id}`);

      // Create tenant database
      try {
        await createTenantDB(tenant.id);
        console.log(`✅ Tenant database created`);
        
        // Initialize tenant models
        const tenantDB = await getTenantDB(tenant.id);
        await initializeTenantModels(tenantDB);
        console.log(`✅ Tenant models initialized`);
        
        // Create default admin user
        const models = await initializeTenantModels(tenantDB);
        const bcrypt = require('bcryptjs');
        
        // Generate random password
        const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
        
        const nameParts = contact_name.split(' ');
        const firstName = nameParts[0] || 'Admin';
        const lastName = nameParts.slice(1).join(' ') || 'User';
        
        const adminUser = await models.User.create({
          email: contact_email,
          password: tempPassword,
          first_name: firstName,
          last_name: lastName,
          role: 'admin',
          status: 'active',
          email_verified: true
        });

        console.log(`✅ Admin user created: ${adminUser.email}`);
        
        // Update tenant status to active
        await tenant.update({ status: 'active' });
        
        res.status(201).json({
          success: true,
          message: 'Tenant created successfully',
          data: {
            tenant: {
              id: tenant.id,
              name: tenant.name,
              domain: tenant.domain,
              subdomain: tenant.subdomain,
              status: tenant.status,
              plan: tenant.plan,
              contact_email: tenant.contact_email,
              contact_name: tenant.contact_name,
              created_at: tenant.created_at
            },
            setup_details: {
              domain: tenant.domain,
              database_created: true,
              admin_created: true,
              ssl_enabled: false, // For development
              nginx_configured: false // For development
            },
            admin_credentials: {
              email: contact_email,
              temp_password: tempPassword,
              note: 'Please change password after first login'
            },
            access_info: {
              domain: tenant.domain,
              api_endpoint: `http://${tenant.domain}/api`,
              health_check: `http://${tenant.domain}/health`
            }
          }
        });

      } catch (dbError) {
        console.error('Database creation failed:', dbError);
        
        // Cleanup: delete tenant record if database creation failed
        await tenant.destroy();
        
        throw new Error(`Database setup failed: ${dbError.message}`);
      }

    } catch (error) {
      console.error('Create tenant error:', error);
      
      res.status(500).json({
        success: false,
        message: 'Tenant creation failed',
        error: error.message,
        code: 'CREATION_ERROR'
      });
    }
  }
);

/**
 * Get single tenant (Master Admin only)
 */
router.get('/:id', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id, {
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
      data: { tenant }
    });

  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tenant'
    });
  }
});

/**
 * Get tenant status (Master Admin only)
 */
router.get('/:id/status', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Simple status check
    const status = {
      tenant_status: tenant.status,
      domain: tenant.domain,
      database: 'unknown',
      last_checked: new Date().toISOString()
    };

    // Check database connection
    try {
      const tenantDB = await getTenantDB(tenant.id);
      await tenantDB.authenticate();
      status.database = 'connected';
    } catch (error) {
      status.database = 'failed';
      status.database_error = error.message;
    }

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
    console.error('Get tenant status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tenant status'
    });
  }
});

/**
 * Delete tenant (Master Admin only)
 */
router.delete('/:id', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    const tenantInfo = {
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain
    };

    // Drop tenant database
    try {
      const dbName = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
      await masterDB.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      console.log(`✅ Tenant database dropped: ${dbName}`);
    } catch (error) {
      console.error('Failed to drop tenant database:', error);
    }

    // Delete tenant record
    await tenant.destroy();

    res.json({
      success: true,
      message: 'Tenant deleted successfully',
      data: { deleted_tenant: tenantInfo }
    });

  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tenant'
    });
  }
});

/**
 * Update tenant (Master Admin only)
 */
router.put('/:id', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    const {
      name,
      contact_email,
      contact_name,
      status,
      plan
    } = req.body;

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (contact_email !== undefined) updateData.contact_email = contact_email;
    if (contact_name !== undefined) updateData.contact_name = contact_name;
    if (status !== undefined) updateData.status = status;
    if (plan !== undefined) updateData.plan = plan;

    await tenant.update(updateData);

    res.json({
      success: true,
      message: 'Tenant updated successfully',
      data: { tenant }
    });

  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update tenant'
    });
  }
});

/**
 * Get tenant analytics (Master Admin only)
 */
router.get('/:id/analytics', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
        code: 'TENANT_NOT_FOUND'
      });
    }

    let analytics = {
      usage: {
        users: 0,
        articles: 0,
        categories: 0,
        tags: 0
      },
      limits: tenant.limits || {
        max_users: 9999999,
        max_articles: 9999999,
        max_categories: 9999999,
        max_tags: 9999999
      },
      content_stats: {
        published_articles: 0,
        draft_articles: 0,
        total_views: 0,
        recent_activity: 0
      },
      plan_info: {
        current_plan: tenant.plan,
        status: tenant.status,
        trial_ends_at: tenant.trial_ends_at
      }
    };

    // Try to get tenant database stats
    try {
      const tenantDB = await getTenantDB(tenant.id);
      const models = await initializeTenantModels(tenantDB);

      const [
        userCount,
        articleCount,
        categoryCount,
        tagCount,
        publishedArticles,
        draftArticles,
        totalViews
      ] = await Promise.all([
        models.User.count().catch(() => 0),
        models.News.count().catch(() => 0),
        models.Category.count().catch(() => 0),
        models.Tag.count().catch(() => 0),
        models.News.count({ where: { status: 'published' } }).catch(() => 0),
        models.News.count({ where: { status: 'draft' } }).catch(() => 0),
        models.News.sum('views_count').catch(() => 0) || 0
      ]);

      analytics.usage = {
        users: userCount,
        articles: articleCount,
        categories: categoryCount,
        tags: tagCount
      };

      analytics.content_stats = {
        published_articles: publishedArticles,
        draft_articles: draftArticles,
        total_views: totalViews,
        recent_activity: articleCount
      };

    } catch (error) {
      console.error('Failed to get tenant analytics:', error);
    }

    // Calculate usage percentages
    analytics.usage_percentage = {
      users: Math.round((analytics.usage.users / analytics.limits.max_users) * 100),
      articles: Math.round((analytics.usage.articles / analytics.limits.max_articles) * 100),
      categories: Math.round((analytics.usage.categories / analytics.limits.max_categories) * 100),
      tags: Math.round((analytics.usage.tags / analytics.limits.max_tags) * 100)
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
    console.error('Get tenant analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tenant analytics'
    });
  }
});

/**
 * Development helper: Create test data (Master Admin only)
 */
router.post('/:id/seed', authenticateMasterAdmin, async (req, res) => {
  try {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const tenantDB = await getTenantDB(tenant.id);
    const models = await initializeTenantModels(tenantDB);

    // Create sample categories
    const techCategory = await models.Category.create({
      name: 'Technology',
      description: 'Latest technology news',
      color: '#3B82F6',
      is_featured: true
    });

    const businessCategory = await models.Category.create({
      name: 'Business',
      description: 'Business and finance news',
      color: '#10B981'
    });

    // Create sample tags
    const tags = await models.Tag.bulkCreate([
      { name: 'breaking', color: '#EF4444' },
      { name: 'trending', color: '#8B5CF6' },
      { name: 'featured', color: '#06B6D4' }
    ]);

    // Find admin user
    const adminUser = await models.User.findOne({
      where: { role: 'admin' }
    });

    if (adminUser) {
      // Create sample articles
      const article1 = await models.News.create({
        title: 'Welcome to Your News Portal',
        slug: 'welcome-to-your-news-portal',
        excerpt: 'This is your first article in the news portal.',
        content: '<p>Welcome to your new news portal! This is a sample article.</p>',
        status: 'published',
        visibility: 'public',
        category_id: techCategory.id,
        author_id: adminUser.id,
        is_featured: true,
        published_at: new Date()
      });

      const article2 = await models.News.create({
        title: 'Getting Started Guide',
        slug: 'getting-started-guide',
        excerpt: 'Learn how to use your news portal.',
        content: '<p>This guide will help you get started with your news portal.</p>',
        status: 'published',
        visibility: 'public',
        category_id: businessCategory.id,
        author_id: adminUser.id,
        published_at: new Date()
      });

      // Associate tags
      await article1.setTags([tags[0], tags[2]]); // breaking, featured
      await article2.setTags([tags[1]]); // trending
    }

    res.json({
      success: true,
      message: 'Test data created successfully',
      data: {
        categories_created: 2,
        tags_created: 3,
        articles_created: adminUser ? 2 : 0
      }
    });

  } catch (error) {
    console.error('Seed tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test data',
      error: error.message
    });
  }
});

module.exports = router;