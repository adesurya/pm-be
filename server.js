// server-optimized.js - Cleaned up and optimized server
const express = require('express');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

console.log('🚀 Starting Optimized News CMS SaaS server...');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for database
let masterDB = null;
let MasterAdmin = null;
let Tenant = null;
let dbInitialized = false;

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'news-cms-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Initialize database and models
const initializeDatabase = async () => {
  try {
    console.log('🔧 Initializing master database...');
    
    const { Sequelize, DataTypes } = require('sequelize');
    
    // Create master database connection
    masterDB = new Sequelize(
      process.env.MASTER_DB_NAME || 'news_cms_master',
      process.env.MASTER_DB_USER || 'root',
      process.env.MASTER_DB_PASS || '',
      {
        host: process.env.MASTER_DB_HOST || 'localhost',
        port: process.env.MASTER_DB_PORT || 3306,
        dialect: 'mysql',
        logging: false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
      }
    );
    
    await masterDB.authenticate();
    console.log('✅ Master database connected');
    
    // Initialize models
    const { initializeMasterModels } = require('./config/masterModels');
    const models = await initializeMasterModels(masterDB);
    
    MasterAdmin = models.MasterAdmin;
    Tenant = models.Tenant;
    
    dbInitialized = true;
    console.log('✅ Database initialization complete');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    dbInitialized = false;
  }
};

// Tenant identification middleware
const identifyTenant = async (req, res, next) => {
  try {
    const host = req.get('host');
    if (!host) return next();

    const domain = host.split(':')[0];
    
    // Skip for localhost without subdomain
    if (domain === 'localhost' || domain === '127.0.0.1') {
      return next();
    }
    
    const parts = domain.split('.');
    let tenant = null;

    if (parts.length >= 2) {
      tenant = await Tenant.findOne({
        where: { domain: domain, status: 'active' }
      });
      
      if (!tenant && parts.length >= 3) {
        const subdomain = parts[0];
        tenant = await Tenant.findOne({
          where: { subdomain: subdomain, status: 'active' }
        });
      }
    }

    if (tenant) {
      console.log(`✅ Tenant identified: ${tenant.name} (${tenant.domain})`);
      req.tenant = tenant;
      req.tenantId = tenant.id;
      
      tenant.last_activity = new Date();
      await tenant.save();
    }

    next();
  } catch (error) {
    console.error('Error identifying tenant:', error);
    next();
  }
};

// Load tenant database
const loadTenantDB = async (req, res, next) => {
  if (!req.tenantId) return next();

  try {
    const { getTenantDB, initializeTenantModels } = require('./config/database');
    
    const tenantDB = await getTenantDB(req.tenantId);
    const models = await initializeTenantModels(tenantDB);

    req.db = tenantDB;
    req.models = models;

    console.log(`✅ Tenant DB loaded for: ${req.tenantId}`);
    next();
  } catch (error) {
    console.error('Error loading tenant database:', error);
    return res.status(500).json({
      success: false,
      message: 'Tenant database connection error',
      code: 'DB_CONNECTION_ERROR'
    });
  }
};

// Apply middleware
app.use(identifyTenant);
app.use(loadTenantDB);

// Add master admin routes DIRECTLY (untuk memastikan terdaftar)
console.log('🔧 Setting up master admin routes directly...');

// Master admin status
app.get('/api/master/status', async (req, res) => {
  console.log('📋 Master status endpoint hit');
  const status = {
    setup_complete: false,
    admin_count: 0,
    requires_setup: true,
    database_connected: dbInitialized,
    version: '1.0.0-optimized',
    timestamp: new Date().toISOString()
  };

  if (dbInitialized && MasterAdmin) {
    try {
      const adminCount = await MasterAdmin.count();
      status.admin_count = adminCount;
      status.setup_complete = adminCount > 0;
      status.requires_setup = adminCount === 0;
    } catch (error) {
      status.error = error.message;
    }
  }

  res.json({ success: true, data: status });
});

// Master admin setup
app.post('/api/master/setup', async (req, res) => {
  console.log('🔧 Master setup endpoint hit');
  try {
    const { email, password, name, master_key } = req.body;
    
    if (!email || !password || !name || !master_key) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['email', 'password', 'name', 'master_key']
      });
    }
    
    const expectedKey = process.env.MASTER_SETUP_KEY || 'master-setup-key-2024';
    if (master_key !== expectedKey) {
      return res.status(403).json({
        success: false,
        message: 'Invalid master setup key'
      });
    }
    
    if (!dbInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Database not initialized'
      });
    }
    
    const existingCount = await MasterAdmin.count();
    if (existingCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Master admin already exists'
      });
    }
    
    const admin = await MasterAdmin.create({
      email: email.toLowerCase().trim(),
      password,
      name: name.trim(),
      role: 'super_admin',
      status: 'active'
    });
    
    const token = admin.generateToken();
    
    res.status(201).json({
      success: true,
      message: 'Master admin created successfully',
      data: {
        admin: admin.toSafeJSON(),
        token,
        token_type: 'Bearer',
        expires_in: '24h'
      }
    });
    
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Setup failed',
      error: error.message
    });
  }
});

// Master admin login
app.post('/api/master/login', async (req, res) => {
  console.log('🔑 Master login endpoint hit');
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    if (!dbInitialized || !MasterAdmin) {
      return res.status(500).json({
        success: false,
        message: 'Database not initialized'
      });
    }
    
    const admin = await MasterAdmin.findOne({
      where: { email: email.toLowerCase().trim() }
    });
    
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const isValid = await admin.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    await admin.update({
      last_login: new Date(),
      last_login_ip: req.ip,
      login_count: (admin.login_count || 0) + 1
    });
    
    const token = admin.generateToken();
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        admin: admin.toSafeJSON(),
        token,
        token_type: 'Bearer',
        expires_in: '24h'
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Master admin profile (dengan auth middleware)
app.get('/api/master/profile', async (req, res) => {
  console.log('👤 Master profile endpoint hit');
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (decoded.type !== 'master_admin') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const admin = await MasterAdmin.findByPk(decoded.id);
    
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive admin account'
      });
    }

    res.json({
      success: true,
      data: {
        admin: admin.toSafeJSON()
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

console.log('✅ Master admin routes added directly');

// Add API docs endpoint
app.get('/api/docs', (req, res) => {
  console.log('📚 API docs endpoint hit');
  res.json({
    success: true,
    message: 'News CMS SaaS API Documentation',
    version: '1.0.0-optimized',
    base_url: `http://localhost:${PORT}`,
    endpoints: {
      master_admin: {
        'GET /api/master/status': 'Check setup status',
        'POST /api/master/setup': 'Setup first admin',
        'POST /api/master/login': 'Admin login',
        'GET /api/master/profile': 'Get profile (requires token)'
      },
      tenant_management: {
        'GET /api/tenant-management': 'List tenants (requires master token)',
        'POST /api/tenant-management': 'Create tenant (requires master token)',
        'PUT /api/tenant-management/:id': 'Update tenant (requires master token)',
        'DELETE /api/tenant-management/:id': 'Delete tenant (requires master token)'
      },
      tenant_api: {
        note: 'Requires Host header with tenant domain',
        'POST /api/auth/login': 'Tenant user login',
        'GET /api/news': 'Get news articles',
        'GET /api/categories': 'Get categories'
      }
    },
    examples: {
      master_login: {
        url: 'POST /api/master/login',
        body: { email: 'admin@system.com', password: 'your_password' }
      },
      tenant_login: {
        url: 'POST /api/auth/login',
        headers: { 'Host': 'yourdomain.localhost' },
        body: { email: 'user@domain.com', password: 'password' }
      }
    }
  });
});

// Add tenant management routes dengan auth middleware
const authenticateMasterAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (decoded.type !== 'master_admin') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const admin = await MasterAdmin.findByPk(decoded.id);
    
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive admin account'
      });
    }

    req.masterAdmin = admin;
    next();

  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Tenant Management Routes
app.get('/api/tenant-management', authenticateMasterAdmin, async (req, res) => {
  console.log('📋 List tenants endpoint hit');
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    const where = {};
    if (search) {
      where[Tenant.sequelize.Sequelize.Op.or] = [
        { name: { [Tenant.sequelize.Sequelize.Op.like]: `%${search}%` } },
        { domain: { [Tenant.sequelize.Sequelize.Op.like]: `%${search}%` } }
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

app.post('/api/tenant-management', authenticateMasterAdmin, async (req, res) => {
  console.log('🏢 Create tenant endpoint hit');
  try {
    const { name, domain, subdomain, contact_email, contact_name, plan = 'trial' } = req.body;

    if (!name || !domain || !contact_email || !contact_name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['name', 'domain', 'contact_email', 'contact_name']
      });
    }

    // Check if domain already exists
    const existingTenant = await Tenant.findOne({
      where: {
        [Tenant.sequelize.Sequelize.Op.or]: [
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

    try {
      // Create tenant database
      const { createTenantDB, getTenantDB, initializeTenantModels } = require('./config/database');
      
      await createTenantDB(tenant.id);
      console.log(`✅ Tenant database created`);
      
      const tenantDB = await getTenantDB(tenant.id);
      const models = await initializeTenantModels(tenantDB);
      console.log(`✅ Tenant models initialized`);
      
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
      await tenant.destroy();
      throw new Error(`Database setup failed: ${dbError.message}`);
    }

  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Tenant creation failed',
      error: error.message
    });
  }
});

app.get('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
  console.log('📋 Get tenant details endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id, {
      attributes: { exclude: ['database_name'] }
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
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

app.put('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
  console.log('✏️ Update tenant endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const { name, contact_email, contact_name, status, plan } = req.body;

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

app.delete('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
  console.log('🗑️ Delete tenant endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
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

app.get('/api/tenant-management/:id/analytics', authenticateMasterAdmin, async (req, res) => {
  console.log('📊 Get tenant analytics endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    let analytics = {
      usage: { users: 0, articles: 0, categories: 0, tags: 0 },
      limits: tenant.limits || { max_users: 9999999, max_articles: 9999999, max_categories: 9999999, max_tags: 9999999 },
      content_stats: { published_articles: 0, draft_articles: 0, total_views: 0, recent_activity: 0 },
      plan_info: { current_plan: tenant.plan, status: tenant.status, trial_ends_at: tenant.trial_ends_at }
    };

    try {
      const { getTenantDB, initializeTenantModels } = require('./config/database');
      const tenantDB = await getTenantDB(tenant.id);
      const models = await initializeTenantModels(tenantDB);

      const [userCount, articleCount, categoryCount, tagCount, publishedArticles, draftArticles, totalViews] = await Promise.all([
        models.User.count().catch(() => 0),
        models.News.count().catch(() => 0),
        models.Category.count().catch(() => 0),
        models.Tag.count().catch(() => 0),
        models.News.count({ where: { status: 'published' } }).catch(() => 0),
        models.News.count({ where: { status: 'draft' } }).catch(() => 0),
        models.News.sum('views_count').catch(() => 0) || 0
      ]);

      analytics.usage = { users: userCount, articles: articleCount, categories: categoryCount, tags: tagCount };
      analytics.content_stats = { published_articles: publishedArticles, draft_articles: draftArticles, total_views: totalViews, recent_activity: articleCount };
    } catch (error) {
      console.error('Failed to get tenant analytics:', error);
    }

    analytics.usage_percentage = {
      users: Math.round((analytics.usage.users / analytics.limits.max_users) * 100),
      articles: Math.round((analytics.usage.articles / analytics.limits.max_articles) * 100),
      categories: Math.round((analytics.usage.categories / analytics.limits.max_categories) * 100),
      tags: Math.round((analytics.usage.tags / analytics.limits.max_tags) * 100)
    };

    res.json({
      success: true,
      data: {
        tenant: { id: tenant.id, name: tenant.name, domain: tenant.domain },
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

app.post('/api/tenant-management/:id/seed', authenticateMasterAdmin, async (req, res) => {
  console.log('🌱 Seed tenant data endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const { getTenantDB, initializeTenantModels } = require('./config/database');
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

    const adminUser = await models.User.findOne({ where: { role: 'admin' } });

    if (adminUser) {
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

      await article1.setTags([tags[0], tags[2]]);
      await article2.setTags([tags[1]]);
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

app.get('/api/tenant-management/:id/status', authenticateMasterAdmin, async (req, res) => {
  console.log('🔍 Get tenant status endpoint hit');
  try {
    const tenant = await Tenant.findByPk(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    const status = {
      tenant_status: tenant.status,
      domain: tenant.domain,
      database: 'unknown',
      last_checked: new Date().toISOString()
    };

    try {
      const { getTenantDB } = require('./config/database');
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
        tenant: { id: tenant.id, name: tenant.name, domain: tenant.domain, status: tenant.status },
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

console.log('✅ Tenant management routes added directly');

// Add basic tenant endpoints (requires tenant context)
app.post('/api/auth/login', async (req, res) => {
  console.log('🔑 Tenant login endpoint hit');
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required. Please check your Host header.',
      code: 'NO_TENANT_CONTEXT',
      help: 'Use Host header like: Host: yourdomain.localhost'
    });
  }

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const user = await req.models.User.findOne({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'User account is not active',
        code: 'USER_INACTIVE'
      });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: req.tenantId
      },
      process.env.JWT_SECRET || 'bulletproof-secret-key-2024',
      { expiresIn: '24h' }
    );

    // Update login info
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    user.login_count += 1;
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        token,
        token_type: 'Bearer',
        expires_in: '24h',
        tenant: {
          id: req.tenant.id,
          name: req.tenant.name,
          domain: req.tenant.domain
        }
      }
    });

  } catch (error) {
    console.error('Tenant login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

app.get('/api/auth/profile', async (req, res) => {
  console.log('👤 Tenant profile endpoint hit');
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required'
    });
  }

  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (decoded.tenantId !== req.tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Token tenant mismatch'
      });
    }

    const user = await req.models.User.findByPk(decoded.userId);
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive user account'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.toJSON(),
        tenant: {
          id: req.tenant.id,
          name: req.tenant.name,
          domain: req.tenant.domain,
          plan: req.tenant.plan
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

app.get('/api/news', async (req, res) => {
  console.log('📰 Get news endpoint hit');
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required',
      code: 'NO_TENANT_CONTEXT'
    });
  }

  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 50);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where[req.models.News.sequelize.Sequelize.Op.or] = [
        { title: { [req.models.News.sequelize.Sequelize.Op.like]: `%${search}%` } },
        { content: { [req.models.News.sequelize.Sequelize.Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: articles } = await req.models.News.findAndCountAll({
      where,
      include: [
        {
          model: req.models.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug', 'color']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: pageLimit,
      offset
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: count,
          items_per_page: pageLimit
        }
      }
    });

  } catch (error) {
    console.error('Get news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch articles'
    });
  }
});

app.get('/api/categories', async (req, res) => {
  console.log('📂 Get categories endpoint hit');
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required',
      code: 'NO_TENANT_CONTEXT'
    });
  }

  try {
    const categories = await req.models.Category.findAll({
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: { categories }
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

console.log('✅ Basic tenant API routes added directly');

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0-optimized',
    tenant: req.tenant ? {
      id: req.tenant.id,
      name: req.tenant.name,
      domain: req.tenant.domain
    } : null,
    database_initialized: dbInitialized
  });
});

// Import and use route modules
const setupRoutes = () => {
  try {
    // Check if route files exist and are properly exported
    const fs = require('fs');
    const path = require('path');
    
    // Master admin routes (create simplified version first)
    const createMasterRoutes = () => {
      const express = require('express');
      const router = express.Router();
      
      // Basic master admin endpoints
      router.get('/status', async (req, res) => {
        const status = {
          setup_complete: false,
          admin_count: 0,
          requires_setup: true,
          database_connected: dbInitialized,
          version: '1.0.0-optimized',
          timestamp: new Date().toISOString()
        };

        if (dbInitialized && MasterAdmin) {
          try {
            const adminCount = await MasterAdmin.count();
            status.admin_count = adminCount;
            status.setup_complete = adminCount > 0;
            status.requires_setup = adminCount === 0;
          } catch (error) {
            status.error = error.message;
          }
        }

        res.json({ success: true, data: status });
      });

      router.post('/setup', async (req, res) => {
        try {
          const { email, password, name, master_key } = req.body;
          
          if (!email || !password || !name || !master_key) {
            return res.status(400).json({
              success: false,
              message: 'Missing required fields',
              required: ['email', 'password', 'name', 'master_key']
            });
          }
          
          const expectedKey = process.env.MASTER_SETUP_KEY || 'master-setup-key-2024';
          if (master_key !== expectedKey) {
            return res.status(403).json({
              success: false,
              message: 'Invalid master setup key'
            });
          }
          
          if (!dbInitialized) {
            return res.status(500).json({
              success: false,
              message: 'Database not initialized'
            });
          }
          
          const existingCount = await MasterAdmin.count();
          if (existingCount > 0) {
            return res.status(409).json({
              success: false,
              message: 'Master admin already exists'
            });
          }
          
          const admin = await MasterAdmin.create({
            email: email.toLowerCase().trim(),
            password,
            name: name.trim(),
            role: 'super_admin',
            status: 'active'
          });
          
          const token = admin.generateToken();
          
          res.status(201).json({
            success: true,
            message: 'Master admin created successfully',
            data: {
              admin: admin.toSafeJSON(),
              token,
              token_type: 'Bearer',
              expires_in: '24h'
            }
          });
          
        } catch (error) {
          console.error('Setup error:', error);
          res.status(500).json({
            success: false,
            message: 'Setup failed',
            error: error.message
          });
        }
      });

      router.post('/login', async (req, res) => {
        try {
          const { email, password } = req.body;
          
          if (!email || !password) {
            return res.status(400).json({
              success: false,
              message: 'Email and password are required'
            });
          }
          
          if (!dbInitialized || !MasterAdmin) {
            return res.status(500).json({
              success: false,
              message: 'Database not initialized'
            });
          }
          
          const admin = await MasterAdmin.findOne({
            where: { email: email.toLowerCase().trim() }
          });
          
          if (!admin || admin.status !== 'active') {
            return res.status(401).json({
              success: false,
              message: 'Invalid credentials'
            });
          }
          
          const isValid = await admin.comparePassword(password);
          if (!isValid) {
            return res.status(401).json({
              success: false,
              message: 'Invalid credentials'
            });
          }
          
          await admin.update({
            last_login: new Date(),
            last_login_ip: req.ip,
            login_count: (admin.login_count || 0) + 1
          });
          
          const token = admin.generateToken();
          
          res.json({
            success: true,
            message: 'Login successful',
            data: {
              admin: admin.toSafeJSON(),
              token,
              token_type: 'Bearer',
              expires_in: '24h'
            }
          });
          
        } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({
            success: false,
            message: 'Login failed'
          });
        }
      });

      // Add profile endpoint
      router.get('/profile', async (req, res) => {
        try {
          const authHeader = req.headers.authorization;
          
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
              success: false,
              message: 'Authorization token required'
            });
          }

          const token = authHeader.substring(7);
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
          
          if (decoded.type !== 'master_admin') {
            return res.status(401).json({
              success: false,
              message: 'Invalid token type'
            });
          }

          const admin = await MasterAdmin.findByPk(decoded.id);
          
          if (!admin || admin.status !== 'active') {
            return res.status(401).json({
              success: false,
              message: 'Invalid or inactive admin account'
            });
          }

          res.json({
            success: true,
            data: {
              admin: admin.toSafeJSON()
            }
          });

        } catch (error) {
          console.error('Get profile error:', error);
          if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
              success: false,
              message: 'Invalid or expired token'
            });
          }
          res.status(500).json({
            success: false,
            message: 'Failed to get profile'
          });
        }
      });

      return router;
    };

    // Create basic tenant management routes
    const createTenantRoutes = () => {
      const express = require('express');
      const router = express.Router();
      
      // Add authentication middleware
      const authenticateMasterAdmin = async (req, res, next) => {
        try {
          const authHeader = req.headers.authorization;
          
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
              success: false,
              message: 'Authorization token required'
            });
          }

          const token = authHeader.substring(7);
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
          
          if (decoded.type !== 'master_admin') {
            return res.status(401).json({
              success: false,
              message: 'Invalid token type'
            });
          }

          const admin = await MasterAdmin.findByPk(decoded.id);
          
          if (!admin || admin.status !== 'active') {
            return res.status(401).json({
              success: false,
              message: 'Invalid or inactive admin account'
            });
          }

          req.masterAdmin = admin;
          next();

        } catch (error) {
          console.error('Auth error:', error);
          res.status(401).json({
            success: false,
            message: 'Authentication failed'
          });
        }
      };

      router.get('/', authenticateMasterAdmin, async (req, res) => {
        try {
          const { page = 1, limit = 20, search } = req.query;
          const offset = (parseInt(page) - 1) * parseInt(limit);
          const pageLimit = Math.min(parseInt(limit), 100);

          const where = {};
          if (search) {
            where[Tenant.sequelize.Sequelize.Op.or] = [
              { name: { [Tenant.sequelize.Sequelize.Op.like]: `%${search}%` } },
              { domain: { [Tenant.sequelize.Sequelize.Op.like]: `%${search}%` } }
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

      // Create tenant
      router.post('/', authenticateMasterAdmin, async (req, res) => {
        try {
          const { name, domain, subdomain, contact_email, contact_name, plan = 'trial' } = req.body;

          if (!name || !domain || !contact_email || !contact_name) {
            return res.status(400).json({
              success: false,
              message: 'Missing required fields',
              required: ['name', 'domain', 'contact_email', 'contact_name']
            });
          }

          // Check if domain already exists
          const existingTenant = await Tenant.findOne({
            where: {
              [Tenant.sequelize.Sequelize.Op.or]: [
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

          try {
            // Create tenant database
            const { createTenantDB, getTenantDB, initializeTenantModels } = require('./config/database');
            
            await createTenantDB(tenant.id);
            console.log(`✅ Tenant database created`);
            
            const tenantDB = await getTenantDB(tenant.id);
            const models = await initializeTenantModels(tenantDB);
            console.log(`✅ Tenant models initialized`);
            
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
            await tenant.destroy();
            throw new Error(`Database setup failed: ${dbError.message}`);
          }

        } catch (error) {
          console.error('Create tenant error:', error);
          res.status(500).json({
            success: false,
            message: 'Tenant creation failed',
            error: error.message
          });
        }
      });

      // Get single tenant
      router.get('/:id', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id, {
            attributes: { exclude: ['database_name'] }
          });

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
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

      // Update tenant
      router.put('/:id', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
            });
          }

          const { name, contact_email, contact_name, status, plan } = req.body;

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

      // Delete tenant
      router.delete('/:id', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
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

      // Get tenant analytics
      router.get('/:id/analytics', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
            });
          }

          let analytics = {
            usage: { users: 0, articles: 0, categories: 0, tags: 0 },
            limits: tenant.limits || { max_users: 9999999, max_articles: 9999999, max_categories: 9999999, max_tags: 9999999 },
            content_stats: { published_articles: 0, draft_articles: 0, total_views: 0, recent_activity: 0 },
            plan_info: { current_plan: tenant.plan, status: tenant.status, trial_ends_at: tenant.trial_ends_at }
          };

          try {
            const { getTenantDB, initializeTenantModels } = require('./config/database');
            const tenantDB = await getTenantDB(tenant.id);
            const models = await initializeTenantModels(tenantDB);

            const [userCount, articleCount, categoryCount, tagCount, publishedArticles, draftArticles, totalViews] = await Promise.all([
              models.User.count().catch(() => 0),
              models.News.count().catch(() => 0),
              models.Category.count().catch(() => 0),
              models.Tag.count().catch(() => 0),
              models.News.count({ where: { status: 'published' } }).catch(() => 0),
              models.News.count({ where: { status: 'draft' } }).catch(() => 0),
              models.News.sum('views_count').catch(() => 0) || 0
            ]);

            analytics.usage = { users: userCount, articles: articleCount, categories: categoryCount, tags: tagCount };
            analytics.content_stats = { published_articles: publishedArticles, draft_articles: draftArticles, total_views: totalViews, recent_activity: articleCount };
          } catch (error) {
            console.error('Failed to get tenant analytics:', error);
          }

          analytics.usage_percentage = {
            users: Math.round((analytics.usage.users / analytics.limits.max_users) * 100),
            articles: Math.round((analytics.usage.articles / analytics.limits.max_articles) * 100),
            categories: Math.round((analytics.usage.categories / analytics.limits.max_categories) * 100),
            tags: Math.round((analytics.usage.tags / analytics.limits.max_tags) * 100)
          };

          res.json({
            success: true,
            data: {
              tenant: { id: tenant.id, name: tenant.name, domain: tenant.domain },
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

      // Seed data for tenant
      router.post('/:id/seed', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
            });
          }

          const { getTenantDB, initializeTenantModels } = require('./config/database');
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

          const adminUser = await models.User.findOne({ where: { role: 'admin' } });

          if (adminUser) {
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

            await article1.setTags([tags[0], tags[2]]);
            await article2.setTags([tags[1]]);
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

      // Get tenant status
      router.get('/:id/status', authenticateMasterAdmin, async (req, res) => {
        try {
          const tenant = await Tenant.findByPk(req.params.id);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: 'Tenant not found'
            });
          }

          const status = {
            tenant_status: tenant.status,
            domain: tenant.domain,
            database: 'unknown',
            last_checked: new Date().toISOString()
          };

          try {
            const { getTenantDB } = require('./config/database');
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
              tenant: { id: tenant.id, name: tenant.name, domain: tenant.domain, status: tenant.status },
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

      return router;
    };

    // Setup routes dengan logging yang lebih detail
    console.log('🔧 Setting up routes...');
    
    const masterRoutes = createMasterRoutes();
    app.use('/api/master', masterRoutes);
    console.log('✅ Master routes mounted on /api/master');
    
    const tenantRoutes = createTenantRoutes();
    app.use('/api/tenant-management', tenantRoutes);
    console.log('✅ Tenant management routes mounted on /api/tenant-management');

    // Load existing API routes with proper error handling
    const routesPath = path.join(__dirname, 'routes', 'index.js');
    if (fs.existsSync(routesPath)) {
      try {
        const apiRoutes = require('./routes/index');
        app.use('/api', apiRoutes);
        console.log('✅ API routes loaded from routes/index.js');
      } catch (error) {
        console.warn('⚠️  Failed to load routes/index.js:', error.message);
        
        // Try loading individual route files directly
        const routeFiles = [
          { path: './routes/auth', mount: '/api/auth' },
          { path: './routes/news', mount: '/api/news' },
          { path: './routes/categories', mount: '/api/categories' },
          { path: './routes/tags', mount: '/api/tags' },
          { path: './routes/users', mount: '/api/users' }
        ];

        for (const route of routeFiles) {
          try {
            const routeModule = require(route.path);
            app.use(route.mount, routeModule);
            console.log(`✅ Route loaded: ${route.mount}`);
          } catch (err) {
            console.warn(`⚠️  Failed to load ${route.path}:`, err.message);
          }
        }
      }
    } else {
      console.warn('⚠️  routes/index.js not found, trying individual routes...');
      
      // Load individual route files directly
      const routeFiles = [
        { path: './routes/auth', mount: '/api/auth' },
        { path: './routes/news', mount: '/api/news' },
        { path: './routes/categories', mount: '/api/categories' },
        { path: './routes/tags', mount: '/api/tags' },
        { path: './routes/users', mount: '/api/users' }
      ];

      for (const route of routeFiles) {
        try {
          const routeModule = require(route.path);
          app.use(route.mount, routeModule);
          console.log(`✅ Route loaded: ${route.mount}`);
        } catch (err) {
          console.warn(`⚠️  Failed to load ${route.path}:`, err.message);
        }
      }
    }

    console.log('✅ All routes loaded successfully');
  } catch (error) {
    console.error('❌ Error loading routes:', error);
  }
};

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    tenant: req.tenant?.domain || 'none'
  });
});

// 404 handler
app.use('*', (req, res) => {
  const tenantEndpoints = [
    'POST /api/auth/login - Tenant user login',
    'GET /api/auth/profile - Get user profile',
    'GET /api/news - Get news articles',
    'POST /api/news - Create news article',
    'GET /api/categories - Get categories',
    'POST /api/categories - Create category',
    'GET /api/tags - Get tags',
    'GET /api/users - Get users (admin only)'
  ];

  const masterEndpoints = [
    'GET /health - Health check',
    'GET /api/master/status - Master admin status',
    'POST /api/master/setup - Setup master admin',
    'POST /api/master/login - Master admin login',
    'GET /api/master/profile - Master admin profile',
    'GET /api/tenant-management - List tenants',
    'POST /api/tenant-management - Create tenant'
  ];

  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    tenant_context: req.tenant ? {
      id: req.tenant.id,
      name: req.tenant.name,
      domain: req.tenant.domain
    } : null,
    available_endpoints: req.tenant ? tenantEndpoints : masterEndpoints,
    note: req.tenant ? 
      'These endpoints require tenant context (Host header)' : 
      'Use Host header for tenant-specific endpoints'
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🔧 Starting optimized News CMS SaaS server...');
    
    await initializeDatabase();
    
    // Comment out setupRoutes untuk sementara
    // setupRoutes();
    
    // Load existing API routes if available
    try {
      const apiRoutes = require('./routes/index');
      app.use('/api', apiRoutes);
      console.log('✅ API routes loaded from routes/index.js');
    } catch (error) {
      console.warn('⚠️  API routes not available:', error.message);
    }
    
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('🎉 Optimized News CMS SaaS Server Started!');
      console.log('================================================');
      console.log(`🚀 Server: http://localhost:${PORT}`);
      console.log(`🏥 Health: http://localhost:${PORT}/health`);
      console.log(`👑 Master: http://localhost:${PORT}/api/master/status`);
      console.log(`🔑 Login: http://localhost:${PORT}/api/master/login`);
      console.log('');
      console.log('💾 Database:', dbInitialized ? 'INITIALIZED' : 'NOT AVAILABLE');
      console.log('✨ Master admin endpoints loaded directly');
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;