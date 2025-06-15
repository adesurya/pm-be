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
          const { page = 1, limit = 20 } = req.query;
          const offset = (parseInt(page) - 1) * parseInt(limit);
          const pageLimit = Math.min(parseInt(limit), 100);

          const { count, rows: tenants } = await Tenant.findAndCountAll({
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

      return router;
    };

    // Setup routes
    app.use('/api/master', createMasterRoutes());
    app.use('/api/tenant-management', createTenantRoutes());

    // Try to load existing API routes if they exist
    const routesPath = path.join(__dirname, 'routes', 'index.js');
    if (fs.existsSync(routesPath)) {
      const apiRoutes = require('./routes/index');
      app.use('/api', apiRoutes);
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
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    available_endpoints: req.tenant ? [
      'POST /api/auth/login',
      'GET /api/news',
      'GET /api/categories'
    ] : [
      'GET /health',
      'GET /api/master/status',
      'POST /api/master/setup'
    ]
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🔧 Starting optimized News CMS SaaS server...');
    
    await initializeDatabase();
    setupRoutes();
    
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('🎉 Optimized News CMS SaaS Server Started!');
      console.log('================================================');
      console.log(`🚀 Server: http://localhost:${PORT}`);
      console.log(`🏥 Health: http://localhost:${PORT}/health`);
      console.log(`👑 Master: http://localhost:${PORT}/api/master/status`);
      console.log('');
      console.log('💾 Database:', dbInitialized ? 'INITIALIZED' : 'NOT AVAILABLE');
      console.log('✨ All endpoints loaded from separate route files');
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