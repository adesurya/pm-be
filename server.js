// server-complete.js - Complete server with tenant and master admin support
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
require('dotenv').config();

console.log('🚀 Starting Complete News CMS SaaS server...');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for database and models
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
    
    // Import Sequelize
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
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        }
      }
    );
    
    // Test connection
    await masterDB.authenticate();
    console.log('✅ Master database connected');
    
    // Define MasterAdmin model
    MasterAdmin = masterDB.define('MasterAdmin', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true }
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      role: {
        type: DataTypes.ENUM('super_admin', 'system_admin'),
        defaultValue: 'super_admin',
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
        allowNull: false
      },
      last_login: {
        type: DataTypes.DATE,
        allowNull: true
      },
      last_login_ip: {
        type: DataTypes.STRING(45),
        allowNull: true
      },
      login_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'master_admins',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      hooks: {
        beforeCreate: async (admin) => {
          if (admin.password) {
            admin.password = await bcrypt.hash(admin.password, 12);
          }
        },
        beforeUpdate: async (admin) => {
          if (admin.changed('password')) {
            admin.password = await bcrypt.hash(admin.password, 12);
          }
          admin.updated_at = new Date();
        }
      }
    });

    // Define Tenant model
    Tenant = masterDB.define('Tenant', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      domain: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
      },
      subdomain: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true
      },
      database_name: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'suspended', 'provisioning'),
        defaultValue: 'provisioning',
        allowNull: false
      },
      plan: {
        type: DataTypes.ENUM('trial', 'basic', 'professional', 'enterprise'),
        defaultValue: 'trial',
        allowNull: false
      },
      settings: {
        type: DataTypes.JSON,
        defaultValue: {
          theme: 'default',
          language: 'en',
          timezone: 'UTC',
          features: {
            analytics: false,
            seo: false,
            advanced_editor: false,
            api_access: false
          }
        },
        allowNull: true
      },
      limits: {
        type: DataTypes.JSON,
        defaultValue: {
          max_users: 9999999,
          max_articles: 9999999,
          max_categories: 9999999,
          max_tags: 9999999,
          storage_mb: 9999999
        },
        allowNull: true
      },
      contact_email: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      contact_name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      trial_ends_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      last_activity: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
      }
    }, {
      tableName: 'tenants',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      hooks: {
        beforeCreate: async (tenant) => {
          if (!tenant.database_name) {
            tenant.database_name = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
          }
          
          if (tenant.plan === 'trial' && !tenant.trial_ends_at) {
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 30);
            tenant.trial_ends_at = trialEnd;
          }
        },
        beforeUpdate: (tenant) => {
          tenant.updated_at = new Date();
        }
      }
    });
    
    // Add instance methods to MasterAdmin
    MasterAdmin.prototype.comparePassword = async function(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    };
    
    MasterAdmin.prototype.generateToken = function() {
      return jwt.sign(
        {
          id: this.id,
          email: this.email,
          name: this.name,
          role: this.role,
          type: 'master_admin'
        },
        process.env.JWT_SECRET || 'bulletproof-secret-key-2024',
        { expiresIn: '24h' }
      );
    };
    
    MasterAdmin.prototype.toSafeJSON = function() {
      const admin = this.toJSON();
      delete admin.password;
      return admin;
    };

    // Add instance methods to Tenant
    Tenant.prototype.isActive = function() {
      return this.status === 'active';
    };

    Tenant.prototype.isTrialExpired = function() {
      if (this.plan !== 'trial' || !this.trial_ends_at) {
        return false;
      }
      return new Date() > this.trial_ends_at;
    };
    
    Tenant.prototype.canCreateUser = function(currentCount) {
      return currentCount < this.limits.max_users;
    };
    
    Tenant.prototype.canCreateArticle = function(currentCount) {
      return currentCount < this.limits.max_articles;
    };
    
    // Sync models to create tables
    await MasterAdmin.sync();
    await Tenant.sync();
    console.log('✅ All models synchronized');
    
    dbInitialized = true;
    console.log('✅ Database initialization complete');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    dbInitialized = false;
    masterDB = null;
    MasterAdmin = null;
    Tenant = null;
  }
};

// Tenant identification middleware
const identifyTenant = async (req, res, next) => {
  try {
    const host = req.get('host');
    
    if (!host) {
      // No host header, might be master admin request
      return next();
    }

    // Remove port if present
    const domain = host.split(':')[0];
    
    // Skip tenant identification for localhost without subdomain
    if (domain === 'localhost' || domain === '127.0.0.1') {
      return next();
    }
    
    // Check if it's a subdomain (e.g., tenant1.localhost)
    const parts = domain.split('.');
    let tenant = null;

    if (parts.length >= 2) {
      // Try to find tenant by full domain first
      tenant = await Tenant.findOne({
        where: { domain: domain, status: 'active' }
      });
      
      // If not found by domain, try subdomain
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
      
      // Update last activity
      tenant.last_activity = new Date();
      await tenant.save();
    }

    next();

  } catch (error) {
    console.error('Error identifying tenant:', error);
    next(); // Continue without tenant context
  }
};

// Load tenant database connection and models
const loadTenantDB = async (req, res, next) => {
  if (!req.tenantId) {
    return next(); // No tenant, continue
  }

  try {
    const { getTenantDB, initializeTenantModels } = require('./config/database');
    
    // Get tenant database connection
    const tenantDB = await getTenantDB(req.tenantId);
    
    // Initialize models for this tenant
    const models = await initializeTenantModels(tenantDB);

    // Store in request for use in controllers
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

// Apply tenant middleware to all routes
app.use(identifyTenant);
app.use(loadTenantDB);

// Master admin authentication middleware
const authenticateMasterAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (decoded.type !== 'master_admin') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    const admin = await MasterAdmin.findByPk(decoded.id);
    
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive admin account',
        code: 'INVALID_ADMIN'
      });
    }

    req.masterAdmin = admin;
    next();

  } catch (error) {
    console.error('Auth error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Tenant authentication middleware
const authenticateTenantUser = async (req, res, next) => {
  try {
    if (!req.tenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant context required',
        code: 'NO_TENANT_CONTEXT'
      });
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (decoded.tenantId !== req.tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Token tenant mismatch',
        code: 'TENANT_MISMATCH'
      });
    }

    const user = await req.models.User.findByPk(decoded.userId);
    
    if (!user || !user.isActive()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive user account',
        code: 'INVALID_USER'
      });
    }

    // Update user activity
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    user.login_count += 1;
    await user.save();

    req.currentUser = user;
    next();

  } catch (error) {
    console.error('Tenant auth error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Tenant database functions
const createTenantDatabase = async (tenantId) => {
  try {
    const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
    
    await masterDB.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Tenant database created: ${dbName}`);
    
    const tenantDB = new masterDB.constructor(
      dbName,
      process.env.MASTER_DB_USER || 'root',
      process.env.MASTER_DB_PASS || '',
      {
        host: process.env.MASTER_DB_HOST || 'localhost',
        port: process.env.MASTER_DB_PORT || 3306,
        dialect: 'mysql',
        logging: false
      }
    );

    await tenantDB.authenticate();
    
    // Initialize basic tenant models
    const User = tenantDB.define('User', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      email: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      password: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      first_name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      last_name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      role: { type: masterDB.Sequelize.DataTypes.ENUM('admin', 'editor', 'contributor'), defaultValue: 'contributor' },
      status: { type: masterDB.Sequelize.DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      email_verified: { type: masterDB.Sequelize.DataTypes.BOOLEAN, defaultValue: false },
      last_login: { type: masterDB.Sequelize.DataTypes.DATE, allowNull: true },
      last_login_ip: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: true },
      login_count: { type: masterDB.Sequelize.DataTypes.INTEGER, defaultValue: 0 },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW },
      updated_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, {
      tableName: 'users',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      hooks: {
        beforeCreate: async (user) => {
          if (user.password) {
            user.password = await bcrypt.hash(user.password, 12);
          }
        }
      }
    });

    // Add user methods
    User.prototype.comparePassword = async function(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    };

    User.prototype.isActive = function() {
      return this.status === 'active';
    };

    User.prototype.canPublish = function() {
      return ['admin', 'editor'].includes(this.role);
    };

    User.prototype.toJSON = function() {
      const values = Object.assign({}, this.get());
      delete values.password;
      return values;
    };

    User.findByEmail = async function(email) {
      return await this.findOne({
        where: { email: email.toLowerCase() }
      });
    };

    const Category = tenantDB.define('Category', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      slug: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      description: { type: masterDB.Sequelize.DataTypes.TEXT },
      color: { type: masterDB.Sequelize.DataTypes.STRING, defaultValue: '#3B82F6' },
      is_featured: { type: masterDB.Sequelize.DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, { tableName: 'categories', timestamps: false });

    const Tag = tenantDB.define('Tag', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      slug: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      color: { type: masterDB.Sequelize.DataTypes.STRING, defaultValue: '#3B82F6' },
      usage_count: { type: masterDB.Sequelize.DataTypes.INTEGER, defaultValue: 0 },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, { tableName: 'tags', timestamps: false });

    const News = tenantDB.define('News', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      title: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      slug: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      content: { type: masterDB.Sequelize.DataTypes.TEXT, allowNull: false },
      excerpt: { type: masterDB.Sequelize.DataTypes.TEXT },
      status: { type: masterDB.Sequelize.DataTypes.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
      visibility: { type: masterDB.Sequelize.DataTypes.ENUM('public', 'private'), defaultValue: 'public' },
      author_id: { type: masterDB.Sequelize.DataTypes.UUID, allowNull: false },
      category_id: { type: masterDB.Sequelize.DataTypes.UUID, allowNull: false },
      views_count: { type: masterDB.Sequelize.DataTypes.INTEGER, defaultValue: 0 },
      published_at: { type: masterDB.Sequelize.DataTypes.DATE },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW },
      updated_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, { 
      tableName: 'news',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    });

    const NewsTag = tenantDB.define('NewsTag', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      news_id: { type: masterDB.Sequelize.DataTypes.UUID, allowNull: false },
      tag_id: { type: masterDB.Sequelize.DataTypes.UUID, allowNull: false },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, { tableName: 'news_tags', timestamps: false });

    // Define associations
    User.hasMany(News, { foreignKey: 'author_id', as: 'articles' });
    News.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
    Category.hasMany(News, { foreignKey: 'category_id', as: 'articles' });
    News.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });
    News.belongsToMany(Tag, { through: NewsTag, foreignKey: 'news_id', otherKey: 'tag_id', as: 'tags' });
    Tag.belongsToMany(News, { through: NewsTag, foreignKey: 'tag_id', otherKey: 'news_id', as: 'articles' });

    // Sync tenant models
    await User.sync();
    await Category.sync();
    await Tag.sync();
    await News.sync();
    await NewsTag.sync();
    
    console.log(`✅ Tenant models created for: ${tenantId}`);
    
    return { tenantDB, User, Category, Tag, News, NewsTag };
    
  } catch (error) {
    console.error(`❌ Failed to create tenant database for ${tenantId}:`, error);
    throw error;
  }
};

// Helper function to generate secure password
function generateSecurePassword(length = 12) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
  
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0-complete',
    tenant: req.tenant ? {
      id: req.tenant.id,
      name: req.tenant.name,
      domain: req.tenant.domain
    } : null,
    database_initialized: dbInitialized
  });
});

// =================== MASTER ADMIN ENDPOINTS ===================

// Master admin status
app.get('/api/master/status', async (req, res) => {
  console.log('📋 Checking master admin status...');
  
  const status = {
    success: true,
    data: {
      setup_complete: false,
      admin_count: 0,
      requires_setup: true,
      database_connected: false,
      database_initialized: dbInitialized,
      version: '1.0.0-complete',
      timestamp: new Date().toISOString()
    }
  };

  if (!dbInitialized) {
    await initializeDatabase();
  }

  if (dbInitialized && masterDB && MasterAdmin) {
    try {
      await masterDB.authenticate();
      status.data.database_connected = true;
      
      const adminCount = await MasterAdmin.count();
      status.data.admin_count = adminCount;
      status.data.setup_complete = adminCount > 0;
      status.data.requires_setup = adminCount === 0;
      
      console.log(`✅ Found ${adminCount} master admin(s)`);
      
    } catch (error) {
      console.error('❌ Database operation failed:', error.message);
      status.data.database_connected = false;
      status.data.error = error.message;
    }
  }

  if (status.data.requires_setup) {
    status.data.setup_instructions = {
      step_1: 'POST /api/master/setup with required fields',
      example: {
        method: 'POST',
        url: '/api/master/setup',
        body: {
          email: 'admin@example.com',
          password: 'SecurePassword123!',
          name: 'System Administrator',
          master_key: process.env.MASTER_SETUP_KEY || 'master-setup-key-2024'
        }
      }
    };
  }

  res.json(status);
});

// Master admin setup
app.post('/api/master/setup', async (req, res) => {
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
      await initializeDatabase();
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
    console.error('❌ Setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Setup failed',
      error: error.message
    });
  }
});

// Master admin login
app.post('/api/master/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    if (!dbInitialized) {
      await initializeDatabase();
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
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Get master admin profile
app.get('/api/master/profile', authenticateMasterAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        admin: req.masterAdmin.toSafeJSON()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// =================== TENANT MANAGEMENT ENDPOINTS ===================

// Get all tenants
app.get('/api/tenant-management', authenticateMasterAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

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

// Create new tenant
app.post('/api/tenant-management', authenticateMasterAdmin, async (req, res) => {
  try {
    const { name, domain, subdomain, contact_email, contact_name, plan = 'trial' } = req.body;

    if (!name || !domain || !contact_email || !contact_name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['name', 'domain', 'contact_email', 'contact_name']
      });
    }

    const validPlans = ['trial', 'basic', 'professional', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan value',
        valid_plans: validPlans
      });
    }

    console.log(`Creating tenant: ${name} (${domain})`);

    // Check if domain already exists
    const whereConditions = [{ domain: domain.trim() }];
    
    if (subdomain && subdomain.trim() !== '') {
      whereConditions.push({ subdomain: subdomain.trim() });
    }

    const existingTenant = await Tenant.findOne({
      where: {
        [masterDB.Sequelize.Op.or]: whereConditions
      }
    });

    if (existingTenant) {
      return res.status(409).json({
        success: false,
        message: 'Domain already exists',
        code: 'DOMAIN_EXISTS'
      });
    }

    // Create tenant record
    const tenantData = {
      name: name.trim(),
      domain: domain.trim(),
      contact_email: contact_email.trim().toLowerCase(),
      contact_name: contact_name.trim(),
      status: 'provisioning',
      plan: plan
    };

    if (subdomain && subdomain.trim() !== '') {
      tenantData.subdomain = subdomain.trim();
    }

    const tenant = await Tenant.create(tenantData);
    console.log(`✅ Tenant record created: ${tenant.id}`);

    try {
      // Create tenant database and basic structure
      const { User } = await createTenantDatabase(tenant.id);
      
      // Generate temporary password
      const tempPassword = generateSecurePassword();
      
      // Create default admin user
      const nameParts = contact_name.trim().split(' ');
      const firstName = nameParts[0] || 'Admin';
      const lastName = nameParts.slice(1).join(' ') || 'User';
      
      const adminUser = await User.create({
        email: contact_email.trim().toLowerCase(),
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
            trial_ends_at: tenant.trial_ends_at,
            created_at: tenant.created_at
          },
          setup_details: {
            domain: tenant.domain,
            database_created: true,
            admin_created: true,
            ssl_enabled: false,
            nginx_configured: false
          },
          admin_credentials: {
            email: contact_email.trim().toLowerCase(),
            temp_password: tempPassword,
            note: 'Please change password after first login'
          },
          access_info: {
            domain: tenant.domain,
            api_endpoint: `http://${tenant.domain}/api`,
            health_check: `http://${tenant.domain}/health`,
            development_access: `http://localhost:3000/api (use Host: ${tenant.domain} header)`
          },
          next_steps: [
            'Save the admin credentials',
            'Access tenant using domain or Host header',
            'Login with admin credentials: POST /api/auth/login',
            'Change default password',
            'Start creating content'
          ]
        }
      });

    } catch (dbError) {
      console.error('Database creation failed:', dbError);
      
      try {
        await tenant.destroy();
        console.log('Cleaned up failed tenant record');
      } catch (cleanupError) {
        console.error('Failed to cleanup tenant record:', cleanupError);
      }
      
      throw new Error(`Database setup failed: ${dbError.message}`);
    }

  } catch (error) {
    console.error('Create tenant error:', error);
    
    let errorMessage = 'Tenant creation failed';
    let errorDetails = error.message;
    let errorCode = 'CREATION_ERROR';
    
    if (error.name === 'SequelizeValidationError') {
      errorMessage = 'Validation error';
      errorDetails = error.errors.map(e => `${e.path}: ${e.message}`).join(', ');
      errorCode = 'VALIDATION_ERROR';
    } else if (error.name === 'SequelizeUniqueConstraintError') {
      errorMessage = 'Duplicate entry';
      errorDetails = 'Domain or subdomain already exists';
      errorCode = 'DUPLICATE_ENTRY';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorDetails,
      code: errorCode
    });
  }
});

// Delete tenant
app.delete('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
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

// =================== TENANT USER ENDPOINTS ===================

// Tenant user login
app.post('/api/auth/login', (req, res, next) => {
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required. Please check your Host header.',
      code: 'NO_TENANT_CONTEXT',
      help: 'Use Host header like: Host: yourdomain.com'
    });
  }
  next();
}, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const user = await req.models.User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (!user.isActive()) {
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

// Get tenant user profile
app.get('/api/auth/profile', authenticateTenantUser, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.currentUser.toJSON(),
        tenant: {
          id: req.tenant.id,
          name: req.tenant.name,
          domain: req.tenant.domain,
          plan: req.tenant.plan
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// =================== NEWS ENDPOINTS ===================

// Get all news articles
app.get('/api/news', (req, res, next) => {
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required',
      code: 'NO_TENANT_CONTEXT'
    });
  }
  next();
}, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 50);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where[masterDB.Sequelize.Op.or] = [
        { title: { [masterDB.Sequelize.Op.like]: `%${search}%` } },
        { content: { [masterDB.Sequelize.Op.like]: `%${search}%` } }
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

// Create new article
app.post('/api/news', authenticateTenantUser, async (req, res) => {
  try {
    const { title, content, excerpt, category_id, status = 'draft' } = req.body;

    if (!title || !content || !category_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['title', 'content', 'category_id']
      });
    }

    // Generate slug from title
    const slugify = require('slugify');
    const slug = slugify(title, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });

    const articleData = {
      title: title.trim(),
      slug,
      content,
      excerpt: excerpt || null,
      category_id,
      status,
      author_id: req.currentUser.id,
      visibility: 'public'
    };

    if (status === 'published') {
      articleData.published_at = new Date();
    }

    const article = await req.models.News.create(articleData);

    // Fetch created article with associations
    const createdArticle = await req.models.News.findByPk(article.id, {
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
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Article created successfully',
      data: { article: createdArticle }
    });

  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create article'
    });
  }
});

// =================== CATEGORIES ENDPOINTS ===================

// Get all categories
app.get('/api/categories', (req, res, next) => {
  if (!req.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant context required',
      code: 'NO_TENANT_CONTEXT'
    });
  }
  next();
}, async (req, res) => {
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

// Create new category
app.post('/api/categories', authenticateTenantUser, async (req, res) => {
  try {
    const { name, description, color = '#3B82F6' } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Generate slug from name
    const slugify = require('slugify');
    const slug = slugify(name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });

    const category = await req.models.Category.create({
      name: name.trim(),
      slug,
      description: description || null,
      color
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { category }
    });

  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message,
    tenant: req.tenant?.domain || 'none'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    tenant: req.tenant ? {
      domain: req.tenant.domain,
      available_endpoints: [
        'POST /api/auth/login',
        'GET /api/news',
        'POST /api/news',
        'GET /api/categories',
        'POST /api/categories'
      ]
    } : {
      available_endpoints: [
        'GET /health',
        'GET /api/master/status',
        'POST /api/master/setup',
        'POST /api/master/login'
      ]
    }
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🔧 Starting complete News CMS SaaS server...');
    
    console.log('Environment check:');
    console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
    console.log('- PORT:', PORT);
    console.log('- MASTER_DB_HOST:', process.env.MASTER_DB_HOST || 'localhost');
    console.log('- MASTER_DB_NAME:', process.env.MASTER_DB_NAME || 'news_cms_master');
    
    // Initialize database
    console.log('🔧 Attempting database initialization...');
    await initializeDatabase();
    
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('🎉 Complete News CMS SaaS Server Started!');
      console.log('================================================');
      console.log(`🚀 Server: http://localhost:${PORT}`);
      console.log(`🏥 Health: http://localhost:${PORT}/health`);
      console.log(`👑 Master: http://localhost:${PORT}/api/master/status`);
      console.log('');
      console.log('🧪 Quick Tests:');
      console.log(`curl http://localhost:${PORT}/health`);
      console.log(`curl http://localhost:${PORT}/api/master/status`);
      console.log('');
      console.log('🏢 For tenant endpoints, use Host header:');
      console.log(`curl -H "Host: yourdomain.com" http://localhost:${PORT}/api/auth/login`);
      console.log('');
      console.log('💾 Database:', dbInitialized ? 'INITIALIZED' : 'NOT AVAILABLE');
      console.log('');
      console.log('✨ Available features:');
      console.log('   ✅ Master admin management');
      console.log('   ✅ Complete tenant management');
      console.log('   ✅ Multi-tenant architecture');
      console.log('   ✅ Tenant-specific authentication');
      console.log('   ✅ Content management per tenant');
      console.log('   ✅ Automatic database provisioning');
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try: PORT=3001 npm start');
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
};

startServer();

module.exports = app;