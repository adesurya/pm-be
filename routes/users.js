// routes/users.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

// Import controllers and middleware
const userController = require('../controllers/userController');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { apiRateLimit } = require('../middleware/security');
const { checkTenantLimits } = require('../middleware/tenant');

// Validation rules
const createUserValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  body('first_name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name is required (1-50 characters)'),
  body('last_name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name is required (1-50 characters)'),
  body('role')
    .isIn(['super_admin', 'admin', 'editor', 'contributor'])
    .withMessage('Invalid role')
];

const updateUserValidation = [
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('first_name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be 1-50 characters'),
  body('last_name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be 1-50 characters'),
  body('role')
    .optional()
    .isIn(['super_admin', 'admin', 'editor', 'contributor'])
    .withMessage('Invalid role'),
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'suspended'])
    .withMessage('Invalid status')
];

const idValidation = [
  param('id')
    .isUUID()
    .withMessage('Valid user ID is required')
];

const queryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1-100'),
  query('role')
    .optional()
    .isIn(['super_admin', 'admin', 'editor', 'contributor'])
    .withMessage('Invalid role filter'),
  query('status')
    .optional()
    .isIn(['active', 'inactive', 'suspended'])
    .withMessage('Invalid status filter'),
  query('search')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search term must be 1-100 characters')
];

const statusValidation = [
  body('status')
    .isIn(['active', 'inactive', 'suspended'])
    .withMessage('Valid status is required')
];

// Protected routes (authentication required)
/**
 * @route   GET /api/users
 * @desc    Get all users
 * @access  Private (Admin+)
 */
router.get('/',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  queryValidation,
  userController.getAllUsers
);

/**
 * @route   GET /api/users/stats
 * @desc    Get user statistics
 * @access  Private (Admin+)
 */
router.get('/stats',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  userController.getUserStats
);

/**
 * @route   GET /api/users/:id
 * @desc    Get single user
 * @access  Private (Admin+ or self)
 */
router.get('/:id',
  requireAuth,
  idValidation,
  userController.getUserById
);

/**
 * @route   POST /api/users
 * @desc    Create new user
 * @access  Private (Admin+)
 */
router.post('/',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  checkTenantLimits('users'),
  createUserValidation,
  userController.createUser
);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Private (Admin+ or self)
 */
router.put('/:id',
  requireAuth,
  idValidation,
  updateUserValidation,
  userController.updateUser
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user
 * @access  Private (Admin+)
 */
router.delete('/:id',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  idValidation,
  userController.deleteUser
);

/**
 * @route   POST /api/users/:id/status
 * @desc    Change user status
 * @access  Private (Admin+)
 */
router.post('/:id/status',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  idValidation,
  statusValidation,
  userController.changeUserStatus
);

/**
 * @route   POST /api/users/:id/reset-password
 * @desc    Reset user password (Admin only)
 * @access  Private (Admin+)
 */
router.post('/:id/reset-password',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  idValidation,
  userController.resetUserPassword
);

module.exports = router;