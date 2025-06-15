// routes/tags.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

// Import controllers and middleware
const tagController = require('../controllers/tagController');
const { requireAuth, requirePermission, optionalAuth } = require('../middleware/auth');
const { apiRateLimit } = require('../middleware/security');
const { checkTenantLimits } = require('../middleware/tenant');

// Validation rules
const createTagValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z0-9\s\-_]+$/)
    .withMessage('Name must be 2-50 characters and contain only letters, numbers, spaces, hyphens, and underscores'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-F]{6}$/i)
    .withMessage('Color must be a valid hex color'),
  body('meta_title')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Meta title must be less than 255 characters'),
  body('meta_description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Meta description must be less than 500 characters')
];

const updateTagValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z0-9\s\-_]+$/)
    .withMessage('Name must be 2-50 characters and contain only letters, numbers, spaces, hyphens, and underscores'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-F]{6}$/i)
    .withMessage('Color must be a valid hex color'),
  body('is_active')
    .optional()
    .isBoolean()
    .withMessage('Is active must be a boolean')
];

const idValidation = [
  param('id')
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[\w-]+$/)
    .withMessage('Valid ID or slug is required')
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
  query('search')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search term must be 1-100 characters'),
  query('active')
    .optional()
    .isBoolean()
    .withMessage('Active must be a boolean'),
  query('min_usage')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Min usage must be a positive integer')
];

const cleanupValidation = [
  body('min_usage')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Min usage must be a positive integer'),
  body('older_than_days')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Older than days must be a positive integer')
];

// Public routes (no authentication required)
/**
 * @route   GET /api/tags
 * @desc    Get all tags (public view)
 * @access  Public
 */
router.get('/',
  apiRateLimit,
  queryValidation,
  optionalAuth,
  tagController.getAllTags
);

/**
 * @route   GET /api/tags/popular
 * @desc    Get popular tags by usage count
 * @access  Public
 */
router.get('/popular',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 50 }),
  tagController.getPopularTags
);

/**
 * @route   GET /api/tags/trending
 * @desc    Get trending tags (used in recent articles)
 * @access  Public
 */
router.get('/trending',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 20 }),
  query('days').optional().isInt({ min: 1, max: 365 }),
  tagController.getTrendingTags
);

/**
 * @route   GET /api/tags/cloud
 * @desc    Get tag cloud data
 * @access  Public
 */
router.get('/cloud',
  apiRateLimit,
  query('min_count').optional().isInt({ min: 1 }),
  tagController.getTagCloud
);

/**
 * @route   GET /api/tags/stats
 * @desc    Get tag statistics
 * @access  Public
 */
router.get('/stats',
  apiRateLimit,
  tagController.getTagStats
);

/**
 * @route   GET /api/tags/:id
 * @desc    Get single tag by ID or slug (public view)
 * @access  Public
 */
router.get('/:id',
  apiRateLimit,
  idValidation,
  optionalAuth,
  tagController.getTagById
);

// Protected routes (authentication required)
/**
 * @route   GET /api/tags/unused
 * @desc    Get unused tags (usage_count = 0)
 * @access  Private (Editor+)
 */
router.get('/admin/unused',
  requireAuth,
  requirePermission('tags', 'read'),
  tagController.getUnusedTags
);

/**
 * @route   POST /api/tags
 * @desc    Create new tag
 * @access  Private (Contributor+)
 */
router.post('/',
  requireAuth,
  requirePermission('tags', 'create'),
  checkTenantLimits('tags'),
  createTagValidation,
  tagController.createTag
);

/**
 * @route   PUT /api/tags/:id
 * @desc    Update tag
 * @access  Private (Editor+)
 */
router.put('/:id',
  requireAuth,
  idValidation,
  requirePermission('tags', 'update'),
  updateTagValidation,
  tagController.updateTag
);

/**
 * @route   DELETE /api/tags/:id
 * @desc    Delete tag
 * @access  Private (Editor+)
 */
router.delete('/:id',
  requireAuth,
  idValidation,
  requirePermission('tags', 'delete'),
  tagController.deleteTag
);

/**
 * @route   POST /api/tags/cleanup
 * @desc    Clean up unused tags
 * @access  Private (Admin+)
 */
router.post('/cleanup',
  requireAuth,
  requirePermission('tags', 'delete'),
  cleanupValidation,
  tagController.cleanupTags
);

/**
 * @route   POST /api/tags/bulk-update-counts
 * @desc    Recalculate usage counts for all tags
 * @access  Private (Admin+)
 */
router.post('/bulk-update-counts',
  requireAuth,
  requirePermission('tags', 'update'),
  tagController.bulkUpdateUsageCounts
);

module.exports = router;