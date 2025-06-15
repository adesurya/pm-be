// bulletproof-server.js - Server with inline models that always works
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('🚀 Starting bulletproof News CMS SaaS server...');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for database and models
let masterDB = null;
let MasterAdmin = null;
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
    console.log('🔧 Initializing database...');
    
    // Import Sequelize
    const { Sequelize, DataTypes } = require('sequelize');
    
    // Create database connection
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
    console.log('✅ Database connected');
    
    // Define MasterAdmin model inline
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
        validate: {
          isEmail: true
        }
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
    
    // Add instance methods
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
    
    // Sync model to create table
    await MasterAdmin.sync();
    console.log('✅ MasterAdmin model synchronized');
    
    dbInitialized = true;
    console.log('✅ Database initialization complete');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    dbInitialized = false;
    masterDB = null;
    MasterAdmin = null;
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS is running (bulletproof mode)',
    timestamp: new Date().toISOString(),
    version: '1.0.0-bulletproof',
    mode: 'bulletproof',
    database_initialized: dbInitialized
  });
});

// Master admin status - bulletproof version
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
      version: '1.0.0-bulletproof',
      timestamp: new Date().toISOString(),
      mode: 'bulletproof'
    }
  };

  if (!dbInitialized) {
    console.log('🔧 Database not initialized, attempting to initialize...');
    await initializeDatabase();
  }

  if (dbInitialized && masterDB && MasterAdmin) {
    try {
      // Test database connection
      await masterDB.authenticate();
      status.data.database_connected = true;
      
      // Check admin count
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
  } else {
    status.data.error = 'Database initialization failed';
  }

  // Add setup instructions if needed
  if (status.data.requires_setup) {
    status.data.setup_instructions = {
      step_1: 'Make sure MySQL is running',
      step_2: 'Check .env file has correct database credentials',
      step_3: 'POST /api/master/setup with required fields',
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

// Master admin setup - bulletproof version
app.post('/api/master/setup', async (req, res) => {
  console.log('🔧 Attempting master admin setup...');
  
  try {
    const { email, password, name, master_key } = req.body;
    
    // Validate input
    if (!email || !password || !name || !master_key) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['email', 'password', 'name', 'master_key'],
        received: {
          email: !!email,
          password: !!password,
          name: !!name,
          master_key: !!master_key
        }
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }
    
    // Check master key
    const expectedKey = process.env.MASTER_SETUP_KEY || 'master-setup-key-2024';
    if (master_key !== expectedKey) {
      return res.status(403).json({
        success: false,
        message: 'Invalid master setup key',
        hint: 'Check MASTER_SETUP_KEY in .env file',
        expected_key_length: expectedKey.length,
        received_key_length: master_key.length
      });
    }
    
    console.log('✅ Input validation passed');
    
    // Initialize database if not already done
    if (!dbInitialized) {
      console.log('🔧 Initializing database for setup...');
      await initializeDatabase();
    }
    
    if (!dbInitialized || !masterDB || !MasterAdmin) {
      return res.status(500).json({
        success: false,
        message: 'Database not available',
        hint: 'Check database connection and credentials'
      });
    }
    
    // Check if admin already exists
    const existingCount = await MasterAdmin.count();
    if (existingCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Master admin already exists',
        existing_count: existingCount,
        hint: 'Use POST /api/master/login instead'
      });
    }
    
    console.log('✅ No existing admins found, creating new admin...');
    
    // Create master admin
    const admin = await MasterAdmin.create({
      email: email.toLowerCase().trim(),
      password,
      name: name.trim(),
      role: 'super_admin',
      status: 'active'
    });
    
    console.log('✅ Master admin created successfully');
    
    // Generate token
    const token = admin.generateToken();
    
    res.status(201).json({
      success: true,
      message: 'Master admin created successfully',
      data: {
        admin: admin.toSafeJSON(),
        token,
        token_type: 'Bearer',
        expires_in: '24h',
        next_steps: [
          'Save the token for authenticated requests',
          'Use the token to access tenant management endpoints',
          'Visit /api/docs for complete API documentation'
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Setup error:', error);
    
    // Handle specific database errors
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'Email already exists',
        code: 'EMAIL_EXISTS'
      });
    }
    
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors.map(e => e.message)
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Setup failed',
      error: error.message
    });
  }
});

// Master admin login - bulletproof version
app.post('/api/master/login', async (req, res) => {
  console.log('🔐 Attempting master admin login...');
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Initialize database if not already done
    if (!dbInitialized) {
      await initializeDatabase();
    }
    
    if (!dbInitialized || !masterDB || !MasterAdmin) {
      return res.status(500).json({
        success: false,
        message: 'Authentication system not available'
      });
    }
    
    // Find admin
    const admin = await MasterAdmin.findOne({
      where: { email: email.toLowerCase().trim() }
    });
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    if (admin.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active'
      });
    }
    
    // Check password
    const isValid = await admin.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Update login info
    await admin.update({
      last_login: new Date(),
      last_login_ip: req.ip,
      login_count: (admin.login_count || 0) + 1
    });
    
    // Generate token
    const token = admin.generateToken();
    
    console.log('✅ Login successful');
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        admin: admin.toSafeJSON(),
        token,
        token_type: 'Bearer',
        expires_in: '24h',
        permissions: [
          'tenant_management',
          'system_administration',
          'user_management'
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Get master admin profile
app.get('/api/master/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bulletproof-secret-key-2024');
    
    if (!dbInitialized || !MasterAdmin) {
      return res.status(500).json({
        success: false,
        message: 'Authentication system not available'
      });
    }
    
    const admin = await MasterAdmin.findByPk(decoded.id);
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.json({
      success: true,
      data: {
        admin: admin.toSafeJSON()
      }
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
});

// API docs
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API Documentation (Bulletproof Mode)',
    version: '1.0.0-bulletproof',
    mode: 'bulletproof',
    note: 'This version includes inline models and bulletproof error handling',
    database_initialized: dbInitialized,
    endpoints: {
      health: 'GET /health - System health check',
      docs: 'GET /api/docs - API documentation',
      master_auth: {
        status: 'GET /api/master/status - Check setup status with diagnostics',
        setup: 'POST /api/master/setup - Setup first master admin',
        login: 'POST /api/master/login - Master admin login',
        profile: 'GET /api/master/profile - Get admin profile (requires auth)'
      }
    },
    quick_start: {
      step_1: 'Check status: GET /api/master/status',
      step_2: 'Setup admin: POST /api/master/setup',
      step_3: 'Login: POST /api/master/login',
      step_4: 'Get profile: GET /api/master/profile'
    }
  });
});

// Basic API endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'News CMS SaaS API (Bulletproof Mode)',
    version: '1.0.0-bulletproof',
    status: 'running',
    mode: 'bulletproof',
    database_initialized: dbInitialized
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message,
    mode: 'bulletproof'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    mode: 'bulletproof',
    available_endpoints: [
      'GET /health',
      'GET /api/docs',
      'GET /api/master/status',
      'POST /api/master/setup',
      'POST /api/master/login',
      'GET /api/master/profile'
    ]
  });
});

// Start server
const startServer = async () => {
  try {
    console.log('🔧 Starting bulletproof server...');
    
    // Check environment
    console.log('Environment check:');
    console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
    console.log('- PORT:', PORT);
    console.log('- MASTER_DB_HOST:', process.env.MASTER_DB_HOST || 'localhost');
    console.log('- MASTER_DB_NAME:', process.env.MASTER_DB_NAME || 'news_cms_master');
    console.log('- JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
    console.log('- MASTER_SETUP_KEY:', process.env.MASTER_SETUP_KEY ? 'SET' : 'NOT SET');
    
    // Try to initialize database
    console.log('🔧 Attempting database initialization...');
    await initializeDatabase();
    
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('🎉 Bulletproof News CMS SaaS Server Started!');
      console.log('================================================');
      console.log(`🚀 Server: http://localhost:${PORT}`);
      console.log(`🏥 Health: http://localhost:${PORT}/health`);
      console.log(`📖 Docs: http://localhost:${PORT}/api/docs`);
      console.log(`👑 Master: http://localhost:${PORT}/api/master/status`);
      console.log(`🔧 Mode: bulletproof`);
      console.log(`💾 Database: ${dbInitialized ? 'INITIALIZED' : 'NOT AVAILABLE'}`);
      console.log('');
      console.log('🧪 Quick Test:');
      console.log(`curl http://localhost:${PORT}/health`);
      console.log(`curl http://localhost:${PORT}/api/master/status`);
      console.log('');
      console.log('✨ Server is ready for requests!');
      console.log('');
      console.log('💡 This bulletproof server includes:');
      console.log('   ✅ Inline model definitions');
      console.log('   ✅ Automatic database initialization');
      console.log('   ✅ Bulletproof error handling');
      console.log('   ✅ Complete authentication system');
      console.log('   ✅ Detailed diagnostics');
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try: PORT=3001 npm run bulletproof');
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