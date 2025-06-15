// routes/categories.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

// Import controllers and middleware
const categoryController = require('../controllers/categoryController');
const { requireAuth, requirePermission, optionalAuth } = require('../middleware/auth');
const { apiRateLimit } = require('../middleware/security');
const { checkTenantLimits } = require('../middleware/tenant');

// Validation rules
const createCategoryValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-F]{6}$/i)
    .withMessage('Color must be a valid hex color'),
  body('parent_id')
    .optional()
    .isUUID()
    .withMessage('Parent ID must be a valid UUID'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Sort order must be a positive integer'),
  body('meta_title')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Meta title must be less than 255 characters'),
  body('meta_description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Meta description must be less than 500 characters')
];

const updateCategoryValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-F]{6}$/i)
    .withMessage('Color must be a valid hex color'),
  body('parent_id')
    .optional()
    .isUUID()
    .withMessage('Parent ID must be a valid UUID'),
  body('sort_order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Sort order must be a positive integer'),
  body('is_active')
    .optional()
    .isBoolean()
    .withMessage('Is active must be a boolean'),
  body('is_featured')
    .optional()
    .isBoolean()
    .withMessage('Is featured must be a boolean')
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
  query('parent_id')
    .optional()
    .custom((value) => {
      if (value === 'null' || value === '') return true;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('Parent ID must be a valid UUID or "null"');
      }
      return true;
    }),
  query('featured')
    .optional()
    .isBoolean()
    .withMessage('Featured must be a boolean'),
  query('active')
    .optional()
    .isBoolean()
    .withMessage('Active must be a boolean')
];

const reorderValidation = [
  body('category_ids')
    .isArray({ min: 1 })
    .withMessage('Category IDs array is required'),
  body('category_ids.*')
    .isUUID()
    .withMessage('All category IDs must be valid UUIDs')
];

// Public routes (no authentication required)
/**
 * @route   GET /api/categories
 * @desc    Get all categories (public view)
 * @access  Public
 */
router.get('/',
  apiRateLimit,
  queryValidation,
  optionalAuth,
  categoryController.getAllCategories
);

/**
 * @route   GET /api/categories/tree
 * @desc    Get category hierarchy tree
 * @access  Public
 */
router.get('/tree',
  apiRateLimit,
  categoryController.getCategoryTree
);

/**
 * @route   GET /api/categories/popular
 * @desc    Get popular categories by article count
 * @access  Public
 */
router.get('/popular',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 50 }),
  categoryController.getPopularCategories
);

/**
 * @route   GET /api/categories/counts
 * @desc    Get categories with article counts
 * @access  Public
 */
router.get('/counts',
  apiRateLimit,
  categoryController.getCategoriesWithCounts
);

/**
 * @route   GET /api/categories/:id
 * @desc    Get single category by ID or slug (public view)
 * @access  Public
 */
router.get('/:id',
  apiRateLimit,
  idValidation,
  optionalAuth,
  categoryController.getCategoryById
);

// Protected routes (authentication required)
/**
 * @route   POST /api/categories
 * @desc    Create new category
 * @access  Private (Editor+)
 */
router.post('/',
  requireAuth,
  requirePermission('categories', 'create'),
  checkTenantLimits('categories'),
  createCategoryValidation,
  categoryController.createCategory
);

/**
 * @route   PUT /api/categories/:id
 * @desc    Update category
 * @access  Private (Editor+)
 */
router.put('/:id',
  requireAuth,
  idValidation,
  requirePermission('categories', 'update'),
  updateCategoryValidation,
  categoryController.updateCategory
);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete category
 * @access  Private (Admin+)
 */
router.delete('/:id',
  requireAuth,
  idValidation,
  requirePermission('categories', 'delete'),
  categoryController.deleteCategory
);

/**
 * @route   POST /api/categories/reorder
 * @desc    Reorder categories
 * @access  Private (Editor+)
 */
router.post('/reorder',
  requireAuth,
  requirePermission('categories', 'update'),
  reorderValidation,
  categoryController.reorderCategories
);

module.exports = router;