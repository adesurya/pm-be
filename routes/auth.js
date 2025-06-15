// routes/auth.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

// Import controllers and middleware
const authController = require('../controllers/authController');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { authRateLimit } = require('../middleware/security');
const { checkTenantLimits } = require('../middleware/tenant');

// Validation rules
const registerValidation = [
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
    .optional()
    .isIn(['super_admin', 'admin', 'editor', 'contributor'])
    .withMessage('Invalid role')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const updateProfileValidation = [
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
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio must be less than 500 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number is required'),
  body('timezone')
    .optional()
    .isLength({ min: 1, max: 50 })
    .withMessage('Invalid timezone'),
  body('language')
    .optional()
    .isLength({ min: 2, max: 5 })
    .withMessage('Invalid language code')
];

const changePasswordValidation = [
  body('current_password')
    .notEmpty()
    .withMessage('Current password is required'),
  body('new_password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must be at least 8 characters with uppercase, lowercase, number and special character')
];

const forgotPasswordValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
];

const resetPasswordValidation = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('new_password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must be at least 8 characters with uppercase, lowercase, number and special character')
];

// Public routes (no authentication required)
/**
 * @route   POST /api/auth/register
 * @desc    Register new user
 * @access  Public
 * @rateLimit 5 requests per 15 minutes
 */
router.post('/register', 
  authRateLimit,
  checkTenantLimits('users'),
  registerValidation,
  authController.register
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 * @rateLimit 5 requests per 15 minutes
 */
router.post('/login',
  authRateLimit,
  loginValidation,
  authController.login
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 * @rateLimit 10 requests per 15 minutes
 */
router.post('/refresh',
  authRateLimit,
  authController.refreshToken
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 * @rateLimit 3 requests per 15 minutes
 */
router.post('/forgot-password',
  authRateLimit,
  forgotPasswordValidation,
  authController.forgotPassword
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 * @rateLimit 5 requests per 15 minutes
 */
router.post('/reset-password',
  authRateLimit,
  resetPasswordValidation,
  authController.resetPassword
);

// Protected routes (authentication required)
/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout',
  requireAuth,
  authController.logout
);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile',
  requireAuth,
  authController.getProfile
);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile',
  requireAuth,
  updateProfileValidation,
  authController.updateProfile
);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put('/change-password',
  requireAuth,
  changePasswordValidation,
  authController.changePassword
);

/**
 * @route   GET /api/auth/verify
 * @desc    Verify authentication status
 * @access  Private
 */
router.get('/verify',
  requireAuth,
  (req, res) => {
    res.json({
      success: true,
      message: 'Token is valid',
      data: {
        user: req.currentUser.toJSON()
      }
    });
  }
);

module.exports = router;