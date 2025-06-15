// server-with-tenant-management.js - Server lengkap dengan tenant management
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('🚀 Starting News CMS SaaS server with full tenant management...');

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
      // PERBAIKAN: Pastikan ENUM values sesuai
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
          max_users: 5,
          max_articles: 100,
          max_categories: 20,
          max_tags: 50,
          storage_mb: 100
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
          // Generate database name if not provided
          if (!tenant.database_name) {
            tenant.database_name = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
          }
          
          // Set trial end date for trial plans
          if (tenant.plan === 'trial' && !tenant.trial_ends_at) {
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 30); // 30 days trial
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

// Middleware untuk authenticating master admin
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

// Utility functions untuk tenant database
const createTenantDatabase = async (tenantId) => {
  try {
    const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
    
    // Create database
    await masterDB.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Tenant database created: ${dbName}`);
    
    // Create tenant database connection
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

    // Test connection
    await tenantDB.authenticate();
    
    // Initialize basic tenant models (simplified)
    const User = tenantDB.define('User', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      email: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      password: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      first_name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      last_name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      role: { type: masterDB.Sequelize.DataTypes.ENUM('admin', 'editor', 'contributor'), defaultValue: 'contributor' },
      status: { type: masterDB.Sequelize.DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
      email_verified: { type: masterDB.Sequelize.DataTypes.BOOLEAN, defaultValue: false },
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

    const Category = tenantDB.define('Category', {
      id: { type: masterDB.Sequelize.DataTypes.UUID, defaultValue: masterDB.Sequelize.DataTypes.UUIDV4, primaryKey: true },
      name: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false },
      slug: { type: masterDB.Sequelize.DataTypes.STRING, allowNull: false, unique: true },
      description: { type: masterDB.Sequelize.DataTypes.TEXT },
      color: { type: masterDB.Sequelize.DataTypes.STRING, defaultValue: '#3B82F6' },
      is_featured: { type: masterDB.Sequelize.DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: masterDB.Sequelize.DataTypes.DATE, defaultValue: masterDB.Sequelize.DataTypes.NOW }
    }, { tableName: 'categories', timestamps: false });

    // Sync tenant models
    await User.sync();
    await Category.sync();
    
    console.log(`✅ Tenant models created for: ${tenantId}`);
    
    return { tenantDB, User, Category };
    
  } catch (error) {
    console.error(`❌ Failed to create tenant database for ${tenantId}:`, error);
    throw error;
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS is running (Full Mode)',
    timestamp: new Date().toISOString(),
    version: '1.0.0-full',
    mode: 'full',
    database_initialized: dbInitialized
  });
});

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
      version: '1.0.0-full',
      timestamp: new Date().toISOString(),
      mode: 'full'
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
    
    if (!dbInitialized || !masterDB || !MasterAdmin) {
      return res.status(500).json({
        success: false,
        message: 'Database not available'
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

// TENANT MANAGEMENT ENDPOINTS
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

    // Validasi input required
    if (!name || !domain || !contact_email || !contact_name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['name', 'domain', 'contact_email', 'contact_name'],
        received: {
          name: !!name,
          domain: !!domain,
          contact_email: !!contact_email,
          contact_name: !!contact_name
        }
      });
    }

    // Validasi plan value
    const validPlans = ['trial', 'basic', 'professional', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan value',
        valid_plans: validPlans,
        received: plan
      });
    }

    // Validasi email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contact_email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    console.log(`Creating tenant: ${name} (${domain})`);

    // Check if domain already exists
    const whereConditions = [{ domain: domain.trim() }];
    
    // Hanya tambahkan kondisi subdomain jika subdomain tidak undefined/null
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
        code: 'DOMAIN_EXISTS',
        existing_domain: existingTenant.domain
      });
    }

    // Prepare tenant data dengan validasi yang ketat
    const tenantData = {
      name: name.trim(),
      domain: domain.trim(),
      contact_email: contact_email.trim().toLowerCase(),
      contact_name: contact_name.trim(),
      status: 'provisioning', // PASTIKAN value ini ada di ENUM
      plan: plan // Sudah divalidasi di atas
    };

    // Hanya set subdomain jika ada dan tidak kosong
    if (subdomain && subdomain.trim() !== '') {
      tenantData.subdomain = subdomain.trim();
    }

    console.log('Creating tenant with data:', JSON.stringify(tenantData, null, 2));

    // Create tenant record
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
            ssl_enabled: false, // Development mode
            nginx_configured: false // Development mode
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
      
      // Cleanup: delete tenant record if database creation failed
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
    
    // Provide more detailed error information
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
    } else if (error.name === 'SequelizeDatabaseError') {
      if (error.message.includes('Data truncated')) {
        errorMessage = 'Invalid data format';
        errorDetails = 'One or more fields contain invalid values';
        errorCode = 'INVALID_DATA';
      }
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorDetails,
      code: errorCode,
      debug_info: process.env.NODE_ENV === 'development' ? {
        error_name: error.name,
        sql_message: error.sqlMessage,
        sql_state: error.sqlState
      } : undefined
    });
  }
});

// Get single tenant
app.get('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
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
app.put('/api/tenant-management/:id', authenticateMasterAdmin, async (req, res) => {
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

// Get tenant analytics
app.get('/api/tenant-management/:id/analytics', authenticateMasterAdmin, async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tenant ID format',
        code: 'INVALID_TENANT_ID'
      });
    }

    // Find tenant
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

    console.log(`Getting analytics for tenant: ${tenant.name} (${tenantId})`);

    // Initialize default analytics
    let analytics = {
      usage: {
        users: 0,
        articles: 0,
        categories: 0,
        tags: 0
      },
      limits: {
        max_users: 999999999, // No practical limit
        max_articles: 999999999, // No practical limit
        max_categories: 999999999, // No practical limit
        max_tags: 999999999, // No practical limit
        storage_mb: 999999999 // No practical limit
      },
      usage_percentage: {
        users: 0,
        articles: 0,
        categories: 0,
        tags: 0
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
        trial_ends_at: tenant.trial_ends_at,
        created_at: tenant.created_at
      },
      tenant_info: {
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        subdomain: tenant.subdomain
      }
    };

    // Try to get tenant database stats
    try {
      console.log(`Connecting to tenant database for: ${tenantId}`);
      
      // Create tenant database connection
      const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
      
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

      // Test connection
      await tenantDB.authenticate();
      console.log(`✅ Connected to tenant database: ${dbName}`);

      // Get table counts using raw queries (more reliable)
      const [userCountResult] = await tenantDB.query('SELECT COUNT(*) as count FROM users WHERE 1=1');
      const [articleCountResult] = await tenantDB.query('SELECT COUNT(*) as count FROM news WHERE 1=1');
      const [categoryCountResult] = await tenantDB.query('SELECT COUNT(*) as count FROM categories WHERE 1=1');
      const [tagCountResult] = await tenantDB.query('SELECT COUNT(*) as count FROM tags WHERE 1=1');
      
      // Get content stats
      const [publishedResult] = await tenantDB.query("SELECT COUNT(*) as count FROM news WHERE status = 'published'");
      const [draftResult] = await tenantDB.query("SELECT COUNT(*) as count FROM news WHERE status = 'draft'");
      const [viewsResult] = await tenantDB.query('SELECT SUM(views_count) as total FROM news WHERE views_count IS NOT NULL');
      
      // Get recent activity (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const formattedDate = thirtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
      
      const [recentResult] = await tenantDB.query(`SELECT COUNT(*) as count FROM news WHERE created_at >= '${formattedDate}'`);

      // Update analytics with real data
      const userCount = userCountResult[0]?.count || 0;
      const articleCount = articleCountResult[0]?.count || 0;
      const categoryCount = categoryCountResult[0]?.count || 0;
      const tagCount = tagCountResult[0]?.count || 0;

      analytics.usage = {
        users: parseInt(userCount),
        articles: parseInt(articleCount),
        categories: parseInt(categoryCount),
        tags: parseInt(tagCount)
      };

      analytics.content_stats = {
        published_articles: parseInt(publishedResult[0]?.count || 0),
        draft_articles: parseInt(draftResult[0]?.count || 0),
        total_views: parseInt(viewsResult[0]?.total || 0),
        recent_activity: parseInt(recentResult[0]?.count || 0)
      };

      // Calculate usage percentages (will be very low since limits are high)
      analytics.usage_percentage = {
        users: Math.round((analytics.usage.users / analytics.limits.max_users) * 100 * 100) / 100, // 2 decimal places
        articles: Math.round((analytics.usage.articles / analytics.limits.max_articles) * 100 * 100) / 100,
        categories: Math.round((analytics.usage.categories / analytics.limits.max_categories) * 100 * 100) / 100,
        tags: Math.round((analytics.usage.tags / analytics.limits.max_tags) * 100 * 100) / 100
      };

      // Close tenant DB connection
      await tenantDB.close();
      console.log(`✅ Analytics retrieved for tenant: ${tenant.name}`);

    } catch (dbError) {
      console.error(`❌ Failed to get tenant database stats for ${tenantId}:`, dbError.message);
      
      // Return default analytics with error info
      analytics.database_error = {
        message: 'Could not connect to tenant database',
        details: dbError.message,
        note: 'This may be normal if tenant was just created'
      };
    }

    res.json({
      success: true,
      data: {
        tenant: analytics.tenant_info,
        analytics: {
          usage: analytics.usage,
          limits: analytics.limits,
          usage_percentage: analytics.usage_percentage,
          content_stats: analytics.content_stats,
          plan_info: analytics.plan_info
        },
        database_error: analytics.database_error,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get tenant analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tenant analytics',
      error: error.message,
      code: 'ANALYTICS_ERROR'
    });
  }
});

// Get tenant status/health
app.get('/api/tenant-management/:id/status', authenticateMasterAdmin, async (req, res) => {
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

    // Check tenant database connection
    let databaseStatus = {
      status: 'unknown',
      message: 'Not checked'
    };

    try {
      const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
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
      await tenantDB.close();

      databaseStatus = {
        status: 'connected',
        message: 'Database connection successful',
        database_name: dbName
      };

    } catch (dbError) {
      databaseStatus = {
        status: 'failed',
        message: 'Database connection failed',
        error: dbError.message
      };
    }

    const status = {
      tenant_status: tenant.status,
      domain: tenant.domain,
      database: databaseStatus,
      plan: tenant.plan,
      created_at: tenant.created_at,
      last_activity: tenant.last_activity,
      last_checked: new Date().toISOString()
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
        health: status
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

//Endpoint untuk update semua tenant limits
app.post('/api/tenant-management/update-limits', authenticateMasterAdmin, async (req, res) => {
  try {
    await updateTenantLimits();
    
    res.json({
      success: true,
      message: 'All tenant limits updated successfully',
      new_limits: {
        max_users: 999999,
        max_articles: 999999,
        max_categories: 999999,
        max_tags: 999999,
        storage_mb: 999999
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update tenant limits',
      error: error.message
    });
  }
});

//Endpoint untuk seed data tenant (untuk testing)
app.post('/api/tenant-management/:id/seed', authenticateMasterAdmin, async (req, res) => {
  try {
    const tenantId = req.params.id;
    
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Connect to tenant database
    const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
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

    // Create sample categories
    await tenantDB.query(`
      INSERT IGNORE INTO categories (id, name, slug, description, color, is_featured, created_at) VALUES
      (UUID(), 'Technology', 'technology', 'Latest technology news', '#3B82F6', 1, NOW()),
      (UUID(), 'Business', 'business', 'Business and finance news', '#10B981', 1, NOW()),
      (UUID(), 'Sports', 'sports', 'Sports news and updates', '#F59E0B', 0, NOW()),
      (UUID(), 'Health', 'health', 'Health and wellness', '#EF4444', 0, NOW()),
      (UUID(), 'Entertainment', 'entertainment', 'Entertainment news', '#8B5CF6', 0, NOW())
    `);

    // Create sample tags
    await tenantDB.query(`
      INSERT IGNORE INTO tags (id, name, slug, color, created_at) VALUES
      (UUID(), 'breaking', 'breaking', '#EF4444', NOW()),
      (UUID(), 'trending', 'trending', '#8B5CF6', NOW()),
      (UUID(), 'featured', 'featured', '#06B6D4', NOW()),
      (UUID(), 'latest', 'latest', '#10B981', NOW()),
      (UUID(), 'popular', 'popular', '#F59E0B', NOW())
    `);

    await tenantDB.close();

    res.json({
      success: true,
      message: 'Sample data created successfully',
      data: {
        categories_created: 5,
        tags_created: 5,
        note: 'You can now create articles using these categories and tags'
      }
    });

  } catch (error) {
    console.error('Seed tenant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sample data',
      error: error.message
    });
  }
});

// Helper function untuk generate secure password
function generateSecurePassword(length = 12) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  // Ensure password has at least one of each required character type
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
  password += '0123456789'[Math.floor(Math.random() * 10)]; // digit
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)]; // special
  
  // Fill remaining length
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle password
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

const syncDatabase = async () => {
  try {
    // Drop dan recreate tabel jika ada perubahan struktur
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Syncing database with force...');
      await MasterAdmin.sync({ force: false });
      await Tenant.sync({ force: false }); // Gunakan force: true jika ingin drop tabel
      console.log('✅ Database synced successfully');
    } else {
      await MasterAdmin.sync();
      await Tenant.sync();
    }
  } catch (error) {
    console.error('❌ Database sync failed:', error);
    throw error;
  }
};

// API docs
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API Documentation (Full Mode)',
    version: '1.0.0-full',
    mode: 'full',
    database_initialized: dbInitialized,
    endpoints: {
      health: 'GET /health - System health check',
      docs: 'GET /api/docs - API documentation',
      master_auth: {
        status: 'GET /api/master/status - Check setup status',
        setup: 'POST /api/master/setup - Setup first master admin',
        login: 'POST /api/master/login - Master admin login',
        profile: 'GET /api/master/profile - Get admin profile'
      },
      tenant_management: {
        list: 'GET /api/tenant-management - List all tenants',
        create: 'POST /api/tenant-management - Create new tenant',
        get: 'GET /api/tenant-management/:id - Get tenant details',
        update: 'PUT /api/tenant-management/:id - Update tenant',
        delete: 'DELETE /api/tenant-management/:id - Delete tenant'
      }
    },
    quick_start: {
      step_1: 'Check status: GET /api/master/status',
      step_2: 'Setup admin: POST /api/master/setup',
      step_3: 'Login: POST /api/master/login',
      step_4: 'Create tenant: POST /api/tenant-management',
      step_5: 'Access tenant via domain'
    }
  });
});

// Basic API endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API (Full Mode)',
    version: '1.0.0-full',
    status: 'running',
    mode: 'full',
    database_initialized: dbInitialized,
    available_endpoints: [
      'GET /health',
      'GET /api/docs',
      'GET /api/master/status',
      'POST /api/master/setup',
      'POST /api/master/login',
      'GET /api/master/profile',
      'GET /api/tenant-management',
      'POST /api/tenant-management',
      'GET /api/tenant-management/:id',
      'PUT /api/tenant-management/:id',
      'DELETE /api/tenant-management/:id',
      'GET /api/tenant-management/:id/analytics',      // BARU
      'GET /api/tenant-management/:id/status',         // BARU
      'POST /api/tenant-management/:id/seed',          // BARU
      'POST /api/tenant-management/update-limits' 
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message,
    mode: 'full'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    mode: 'full',
    available_endpoints: [
      'GET /health',
      'GET /api/docs',
      'GET /api/master/status',
      'POST /api/master/setup',
      'POST /api/master/login',
      'GET /api/master/profile',
      'GET /api/tenant-management',
      'POST /api/tenant-management',
      'GET /api/tenant-management/:id',
      'PUT /api/tenant-management/:id',
      'DELETE /api/tenant-management/:id'
    ]
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🔧 Starting full News CMS SaaS server...');
    
    // Check environment
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
      console.log('🎉 Full News CMS SaaS Server Started!');
      console.log('================================================');
      console.log(`🚀 Server: http://localhost:${PORT}`);
      console.log(`🏥 Health: http://localhost:${PORT}/health`);
      console.log(`📖 Docs: http://localhost:${PORT}/api/docs`);
      console.log(`👑 Master: http://localhost:${PORT}/api/master/status`);
      console.log(`🏢 Tenants: http://localhost:${PORT}/api/tenant-management`);
      console.log(`🔧 Mode: full`);
      console.log(`💾 Database: ${dbInitialized ? 'INITIALIZED' : 'NOT AVAILABLE'}`);
      console.log('');
      console.log('🧪 Quick Test:');
      console.log(`curl http://localhost:${PORT}/health`);
      console.log(`curl http://localhost:${PORT}/api/master/status`);
      console.log('');
      console.log('✨ Server is ready with full tenant management!');
      console.log('');
      console.log('💡 Available features:');
      console.log('   ✅ Master admin management');
      console.log('   ✅ Complete tenant management');
      console.log('   ✅ Automatic database provisioning');
      console.log('   ✅ Multi-tenant architecture');
      console.log('   ✅ RESTful API endpoints');
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