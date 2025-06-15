// routes/masterAuth.js
const express = require('express');
const { body } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { masterDB } = require('../config/database');

// Master Admin model (stored in master database)
const MasterAdmin = masterDB.define('MasterAdmin', {
  id: {
    type: masterDB.Sequelize.DataTypes.UUID,
    defaultValue: masterDB.Sequelize.DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: masterDB.Sequelize.DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: masterDB.Sequelize.DataTypes.STRING(255),
    allowNull: false
  },
  name: {
    type: masterDB.Sequelize.DataTypes.STRING(100),
    allowNull: false
  },
  role: {
    type: masterDB.Sequelize.DataTypes.ENUM('super_admin', 'system_admin'),
    defaultValue: 'super_admin',
    allowNull: false
  },
  status: {
    type: masterDB.Sequelize.DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
    allowNull: false
  },
  last_login: {
    type: masterDB.Sequelize.DataTypes.DATE,
    allowNull: true
  },
  login_count: {
    type: masterDB.Sequelize.DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'master_admins',
  timestamps: true,
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
    }
  }
});

// Instance methods
MasterAdmin.prototype.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

MasterAdmin.prototype.generateToken = function() {
  return jwt.sign(
    {
      id: this.id,
      email: this.email,
      role: this.role,
      type: 'master_admin'
    },
    process.env.JWT_SECRET || 'master-secret-key',
    { expiresIn: '24h' }
  );
};

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
const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
  body('master_key').equals(process.env.MASTER_SETUP_KEY || 'master-setup-key-2024').withMessage('Invalid master setup key')
];

/**
 * @route   POST /api/master/setup
 * @desc    Setup first super admin (only works if no admins exist)
 * @access  Public (with master key)
 */
router.post('/setup', registerValidation, handleValidationErrors, async (req, res) => {
  try {
    // Check if any master admins already exist
    const adminCount = await MasterAdmin.count();
    if (adminCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'Master admin already exists. Use login instead.',
        code: 'SETUP_ALREADY_COMPLETE'
      });
    }

    const { email, password, name } = req.body;

    // Create first super admin
    const masterAdmin = await MasterAdmin.create({
      email,
      password,
      name,
      role: 'super_admin',
      status: 'active'
    });

    const token = masterAdmin.generateToken();

    console.log(`✅ Master admin created: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Master admin setup completed successfully',
      data: {
        admin: {
          id: masterAdmin.id,
          email: masterAdmin.email,
          name: masterAdmin.name,
          role: masterAdmin.role
        },
        token,
        setup_complete: true
      }
    });

  } catch (error) {
    console.error('Master setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Setup failed',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/master/login
 * @desc    Master admin login
 * @access  Public
 */
router.post('/login', loginValidation, handleValidationErrors, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find master admin
    const admin = await MasterAdmin.findOne({
      where: { email: email.toLowerCase() }
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (admin.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Verify password
    const isValidPassword = await admin.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Update login info
    await admin.update({
      last_login: new Date(),
      login_count: admin.login_count + 1
    });

    const token = admin.generateToken();

    console.log(`✅ Master admin logged in: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          last_login: admin.last_login
        },
        token,
        token_type: 'Bearer',
        expires_in: '24h'
      }
    });

  } catch (error) {
    console.error('Master login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

/**
 * @route   GET /api/master/profile
 * @desc    Get master admin profile
 * @access  Private
 */
router.get('/profile', authenticateMasterAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        admin: {
          id: req.masterAdmin.id,
          email: req.masterAdmin.email,
          name: req.masterAdmin.name,
          role: req.masterAdmin.role,
          status: req.masterAdmin.status,
          last_login: req.masterAdmin.last_login,
          login_count: req.masterAdmin.login_count
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

/**
 * @route   GET /api/master/status
 * @desc    Check master admin setup status
 * @access  Public
 */
router.get('/status', async (req, res) => {
  try {
    const adminCount = await MasterAdmin.count();
    
    res.json({
      success: true,
      data: {
        setup_complete: adminCount > 0,
        admin_count: adminCount,
        requires_setup: adminCount === 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check status'
    });
  }
});

/**
 * Authentication middleware for master admin
 */
async function authenticateMasterAdmin(req, res, next) {
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
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'master-secret-key');
    
    if (decoded.type !== 'master_admin') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    // Find master admin
    const admin = await MasterAdmin.findByPk(decoded.id);
    
    if (!admin || admin.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive admin',
        code: 'INVALID_ADMIN'
      });
    }

    req.masterAdmin = admin;
    next();

  } catch (error) {
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
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
}

// Initialize master admin table
const initializeMasterAuth = async () => {
  try {
    await MasterAdmin.sync();
    console.log('✅ Master admin table synchronized');
  } catch (error) {
    console.error('❌ Failed to initialize master auth:', error);
  }
};

module.exports = {
  router,
  MasterAdmin,
  authenticateMasterAdmin,
  initializeMasterAuth
};