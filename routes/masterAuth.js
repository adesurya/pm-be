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
  last_login_ip: {
    type: masterDB.Sequelize.DataTypes.STRING(45),
    allowNull: true
  },
  login_count: {
    type: masterDB.Sequelize.DataTypes.INTEGER,
    defaultValue: 0
  },
  created_at: {
    type: masterDB.Sequelize.DataTypes.DATE,
    defaultValue: masterDB.Sequelize.DataTypes.NOW
  },
  updated_at: {
    type: masterDB.Sequelize.DataTypes.DATE,
    defaultValue: masterDB.Sequelize.DataTypes.NOW
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

// Instance methods
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
    process.env.JWT_SECRET || 'master-secret-key-2024',
    { expiresIn: '24h' }
  );
};

MasterAdmin.prototype.toSafeJSON = function() {
  const admin = this.toJSON();
  delete admin.password;
  return admin;
};

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Rate limiting for auth endpoints
const authRateLimit = (req, res, next) => {
  // Simple in-memory rate limiting for demo
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  if (!global.authAttempts) {
    global.authAttempts = new Map();
  }
  
  const attempts = global.authAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(timestamp => now - timestamp < windowMs);
  
  if (recentAttempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retry_after: Math.ceil((recentAttempts[0] + windowMs - now) / 1000)
    });
  }
  
  recentAttempts.push(now);
  global.authAttempts.set(ip, recentAttempts);
  
  next();
};

// Validation rules
const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2-100 characters'),
  body('master_key')
    .equals(process.env.MASTER_SETUP_KEY || 'master-setup-key-2024')
    .withMessage('Invalid master setup key')
];

/**
 * @route   GET /api/master/status
 * @desc    Check master admin setup status
 * @access  Public
 */
router.get('/status', async (req, res) => {
  try {
    const adminCount = await MasterAdmin.count();
    const setupComplete = adminCount > 0;
    
    const status = {
      setup_complete: setupComplete,
      admin_count: adminCount,
      requires_setup: !setupComplete,
      version: '1.0.0',
      database_connected: true,
      timestamp: new Date().toISOString()
    };
    
    if (!setupComplete) {
      status.setup_instructions = {
        step_1: 'POST /api/master/setup with email, password, name, and master_key',
        master_key_env: 'Set MASTER_SETUP_KEY in .env file',
        example: {
          method: 'POST',
          url: '/api/master/setup',
          body: {
            email: 'admin@example.com',
            password: 'SecurePassword123!',
            name: 'System Administrator',
            master_key: 'your-master-setup-key'
          }
        }
      };
    } else {
      status.login_instructions = {
        step_1: 'POST /api/master/login with email and password',
        step_2: 'Use returned token for authenticated requests',
        example: {
          method: 'POST',
          url: '/api/master/login',
          body: {
            email: 'admin@example.com',
            password: 'SecurePassword123!'
          }
        }
      };
    }
    
    res.json({
      success: true,
      data: status
    });
    
  } catch (error) {
    console.error('Master status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check master admin status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @route   POST /api/master/setup
 * @desc    Setup first super admin (only works if no admins exist)
 * @access  Public (with master key)
 */
router.post('/setup', 
  authRateLimit,
  registerValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      // Check if any master admins already exist
      const adminCount = await MasterAdmin.count();
      if (adminCount > 0) {
        return res.status(403).json({
          success: false,
          message: 'Master admin already exists. Use login instead.',
          code: 'SETUP_ALREADY_COMPLETE',
          login_url: '/api/master/login'
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
          admin: masterAdmin.toSafeJSON(),
          token,
          token_type: 'Bearer',
          expires_in: '24h',
          setup_complete: true,
          next_steps: [
            'Save the token for authenticated requests',
            'Visit /api/tenant-management to create tenants',
            'Use /api/docs for full API documentation'
          ]
        }
      });

    } catch (error) {
      console.error('Master setup error:', error);
      
      // Handle specific database errors
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          success: false,
          message: 'An admin with this email already exists',
          code: 'EMAIL_EXISTS'
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Setup failed',
        code: 'SETUP_ERROR',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/master/login
 * @desc    Master admin login
 * @access  Public
 */
router.post('/login', 
  authRateLimit,
  loginValidation, 
  handleValidationErrors, 
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find master admin
      const admin = await MasterAdmin.findOne({
        where: { email: email.toLowerCase() }
      });

      if (!admin) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
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
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Update login info
      await admin.update({
        last_login: new Date(),
        last_login_ip: req.ip,
        login_count: admin.login_count + 1
      });

      const token = admin.generateToken();

      console.log(`✅ Master admin logged in: ${email} from ${req.ip}`);

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
          ],
          available_endpoints: [
            'GET /api/tenant-management - List tenants',
            'POST /api/tenant-management - Create tenant',
            'GET /api/master/profile - Get profile'
          ]
        }
      });

    } catch (error) {
      console.error('Master login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        code: 'LOGIN_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/master/profile
 * @desc    Get master admin profile
 * @access  Private (Master Admin)
 */
router.get('/profile', authenticateMasterAdmin, async (req, res) => {
  try {
    const admin = req.masterAdmin;
    
    res.json({
      success: true,
      data: {
        admin: admin.toSafeJSON(),
        permissions: [
          'tenant_management',
          'system_administration',
          'user_management'
        ],
        statistics: {
          total_tenants: await getTenantCount(),
          active_tenants: await getActiveTenantCount(),
          last_login: admin.last_login,
          login_count: admin.login_count
        }
      }
    });
  } catch (error) {
    console.error('Get master profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

/**
 * @route   POST /api/master/logout
 * @desc    Master admin logout (invalidate token)
 * @access  Private (Master Admin)
 */
router.post('/logout', authenticateMasterAdmin, async (req, res) => {
  try {
    // In a production system, you would maintain a token blacklist
    // For now, we just return success
    
    console.log(`Master admin logged out: ${req.masterAdmin.email}`);
    
    res.json({
      success: true,
      message: 'Logout successful',
      note: 'Token will expire naturally after 24 hours'
    });
  } catch (error) {
    console.error('Master logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

/**
 * @route   PUT /api/master/profile
 * @desc    Update master admin profile
 * @access  Private (Master Admin)
 */
router.put('/profile', 
  authenticateMasterAdmin,
  [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('email').optional().isEmail().normalizeEmail()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const admin = req.masterAdmin;
      const { name, email } = req.body;
      
      const updateData = {};
      if (name) updateData.name = name;
      if (email && email !== admin.email) {
        // Check if email is already taken
        const existingAdmin = await MasterAdmin.findOne({
          where: { 
            email,
            id: { [masterDB.Sequelize.Op.ne]: admin.id }
          }
        });
        
        if (existingAdmin) {
          return res.status(409).json({
            success: false,
            message: 'Email already in use',
            code: 'EMAIL_EXISTS'
          });
        }
        
        updateData.email = email;
      }
      
      if (Object.keys(updateData).length > 0) {
        await admin.update(updateData);
      }
      
      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          admin: admin.toSafeJSON()
        }
      });
      
    } catch (error) {
      console.error('Update master profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }
);

/**
 * @route   PUT /api/master/change-password
 * @desc    Change master admin password
 * @access  Private (Master Admin)
 */
router.put('/change-password',
  authenticateMasterAdmin,
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('New password must be at least 8 characters with uppercase, lowercase, number and special character')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const admin = req.masterAdmin;
      const { current_password, new_password } = req.body;
      
      // Verify current password
      const isValidPassword = await admin.comparePassword(current_password);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect',
          code: 'INVALID_PASSWORD'
        });
      }
      
      // Update password
      await admin.update({ password: new_password });
      
      console.log(`Password changed for master admin: ${admin.email}`);
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
      
    } catch (error) {
      console.error('Change master password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change password'
      });
    }
  }
);

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
        code: 'NO_TOKEN',
        required_format: 'Authorization: Bearer <token>'
      });
    }

    const token = authHeader.substring(7);
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'master-secret-key-2024');
    
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
        message: 'Invalid or inactive admin account',
        code: 'INVALID_ADMIN'
      });
    }

    req.masterAdmin = admin;
    next();

  }  catch (error) {
    console.error('Error :', error);
  }
}