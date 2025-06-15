// routes/news.js
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

// Import controllers and middleware
const newsController = require('../controllers/newsController');
const { requireAuth, requirePermission, requireOwnership, optionalAuth } = require('../middleware/auth');
const { apiRateLimit } = require('../middleware/security');
const { checkTenantLimits } = require('../middleware/tenant');
const { uploadSingleImage } = require('../middleware/upload');

// Validation rules
const createNewsValidation = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Title must be between 5-255 characters'),
  body('content')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Content must be at least 10 characters'),
  body('excerpt')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Excerpt must be less than 500 characters'),
  body('category_id')
    .isUUID()
    .withMessage('Valid category ID is required'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'archived'])
    .withMessage('Invalid status'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'password'])
    .withMessage('Invalid visibility'),
  body('featured_image_alt')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Image alt text must be less than 255 characters'),
  body('meta_title')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Meta title must be less than 255 characters'),
  body('meta_description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Meta description must be less than 500 characters'),
  body('scheduled_at')
    .optional()
    .isISO8601()
    .withMessage('Valid date is required for scheduled publishing'),
  body('is_featured')
    .optional()
    .isBoolean()
    .withMessage('Is featured must be boolean'),
  body('is_breaking')
    .optional()
    .isBoolean()
    .withMessage('Is breaking must be boolean'),
  body('allow_comments')
    .optional()
    .isBoolean()
    .withMessage('Allow comments must be boolean')
];

const updateNewsValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Title must be between 5-255 characters'),
  body('content')
    .optional()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Content must be at least 10 characters'),
  body('excerpt')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Excerpt must be less than 500 characters'),
  body('category_id')
    .optional()
    .isUUID()
    .withMessage('Valid category ID is required'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'archived'])
    .withMessage('Invalid status'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'password'])
    .withMessage('Invalid visibility'),
  body('remove_featured_image')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('Remove featured image must be true or false'),
  body('scheduled_at')
    .optional()
    .isISO8601()
    .withMessage('Valid date is required for scheduled publishing')
];

const idValidation = [
  param('id')
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[\w-]+$/)
    .withMessage('Valid ID or slug is required')
];

const publishValidation = [
  body('action')
    .isIn(['publish', 'unpublish'])
    .withMessage('Action must be either "publish" or "unpublish"')
];

const bulkOperationValidation = [
  body('action')
    .isIn(['publish', 'unpublish', 'delete', 'feature', 'unfeature'])
    .withMessage('Invalid bulk action'),
  body('article_ids')
    .isArray({ min: 1 })
    .withMessage('Article IDs array is required'),
  body('article_ids.*')
    .isUUID()
    .withMessage('All article IDs must be valid UUIDs')
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
  query('status')
    .optional()
    .isIn(['draft', 'review', 'published', 'archived'])
    .withMessage('Invalid status filter'),
  query('sort')
    .optional()
    .isIn(['created_at', 'updated_at', 'published_at', 'title', 'views_count'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['ASC', 'DESC'])
    .withMessage('Order must be ASC or DESC')
];

// Public routes (no authentication required)
/**
 * @route   GET /api/news/published
 * @desc    Get published news articles (public view)
 * @access  Public
 * @rateLimit Standard API rate limit
 */
router.get('/published',
  apiRateLimit,
  queryValidation,
  optionalAuth,
  newsController.getPublishedNews
);

/**
 * @route   GET /api/news/featured
 * @desc    Get featured news articles
 * @access  Public
 */
router.get('/featured',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 20 }),
  newsController.getFeaturedNews
);

/**
 * @route   GET /api/news/breaking
 * @desc    Get breaking news articles
 * @access  Public
 */
router.get('/breaking',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 10 }),
  newsController.getBreakingNews
);

/**
 * @route   GET /api/news/popular
 * @desc    Get popular news articles
 * @access  Public
 */
router.get('/popular',
  apiRateLimit,
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('days').optional().isInt({ min: 1, max: 365 }),
  newsController.getPopularNews
);

/**
 * @route   GET /api/news/:id/public
 * @desc    Get single published article (public view)
 * @access  Public
 */
router.get('/:id/public',
  apiRateLimit,
  idValidation,
  optionalAuth,
  newsController.getPublishedNews
);

// Protected routes (authentication required)
/**
 * @route   GET /api/news
 * @desc    Get all news articles (with permissions)
 * @access  Private
 */
router.get('/',
  requireAuth,
  queryValidation,
  newsController.getAllNews
);

/**
 * @route   GET /api/news/stats
 * @desc    Get news statistics
 * @access  Private (Editor+)
 */
router.get('/stats',
  requireAuth,
  requirePermission('news', 'read'),
  newsController.getNewsStats
);

/**
 * @route   GET /api/news/:id
 * @desc    Get single news article by ID or slug
 * @access  Private
 */
router.get('/:id',
  requireAuth,
  idValidation,
  newsController.getNewsById
);

/**
 * @route   POST /api/news
 * @desc    Create new news article with optional image upload
 * @access  Private (Contributor+)
 * @upload  Single image file (optional)
 */
router.post('/',
  requireAuth,
  requirePermission('news', 'create'),
  checkTenantLimits('articles'),
  uploadSingleImage('articles'), // Handle image upload
  createNewsValidation,
  newsController.createNews
);

/**
 * @route   PUT /api/news/:id
 * @desc    Update news article with optional image upload
 * @access  Private (Owner, Editor+)
 * @upload  Single image file (optional)
 */
router.put('/:id',
  requireAuth,
  idValidation,
  uploadSingleImage('articles'), // Handle image upload
  updateNewsValidation,
  newsController.updateNews
);

/**
 * @route   DELETE /api/news/:id
 * @desc    Delete news article
 * @access  Private (Owner, Admin+)
 */
router.delete('/:id',
  requireAuth,
  idValidation,
  requirePermission('news', 'delete'),
  newsController.deleteNews
);

/**
 * @route   POST /api/news/:id/publish
 * @desc    Publish or unpublish article
 * @access  Private (Editor+)
 */
router.post('/:id/publish',
  requireAuth,
  idValidation,
  publishValidation,
  requirePermission('news', 'publish'),
  newsController.togglePublishStatus
);

/**
 * @route   POST /api/news/bulk
 * @desc    Bulk operations on articles
 * @access  Private (Editor+)
 */
router.post('/bulk',
  requireAuth,
  bulkOperationValidation,
  requirePermission('news', 'update'),
  newsController.bulkOperations
);

/**
 * @route   POST /api/news/:id/like
 * @desc    Like/unlike article
 * @access  Private
 */
router.post('/:id/like',
  requireAuth,
  idValidation,
  async (req, res) => {
    try {
      const article = await req.models.News.findByPk(req.params.id);
      
      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Article not found'
        });
      }

      if (!article.canBeViewedByPublic() && article.author_id !== req.currentUser.id) {
        return res.status(403).json({
          success: false,
          message: 'Cannot like this article'
        });
      }

      await article.increment('likes_count');

      res.json({
        success: true,
        message: 'Article liked',
        data: {
          likes_count: article.likes_count + 1
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to like article'
      });
    }
  }
);

/**
 * @route   POST /api/news/:id/share
 * @desc    Track article share
 * @access  Public
 */
router.post('/:id/share',
  apiRateLimit,
  idValidation,
  body('platform').optional().isIn(['facebook', 'twitter', 'linkedin', 'whatsapp', 'email', 'copy']),
  async (req, res) => {
    try {
      const article = await req.models.News.findByPk(req.params.id);
      
      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Article not found'
        });
      }

      if (!article.canBeViewedByPublic()) {
        return res.status(403).json({
          success: false,
          message: 'Cannot share this article'
        });
      }

      await article.increment('shares_count');

      res.json({
        success: true,
        message: 'Share tracked',
        data: {
          shares_count: article.shares_count + 1,
          platform: req.body.platform || 'unknown'
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to track share'
      });
    }
  }
);

/**
 * @route   GET /api/news/:id/related
 * @desc    Get related articles based on category and tags
 * @access  Public
 */
router.get('/:id/related',
  apiRateLimit,
  idValidation,
  query('limit').optional().isInt({ min: 1, max: 10 }),
  async (req, res) => {
    try {
      const article = await req.models.News.findByPk(req.params.id, {
        include: [
          {
            model: req.models.Tag,
            as: 'tags',
            attributes: ['id']
          }
        ]
      });

      if (!article) {
        return res.status(404).json({
          success: false,
          message: 'Article not found'
        });
      }

      const limit = parseInt(req.query.limit) || 5;
      const tagIds = article.tags.map(tag => tag.id);

      // Find related articles
      const where = {
        id: { [req.models.News.sequelize.Sequelize.Op.ne]: article.id },
        status: 'published',
        visibility: 'public'
      };

      // Priority: same category or matching tags
      const relatedArticles = await req.models.News.findAll({
        where: {
          ...where,
          [req.models.News.sequelize.Sequelize.Op.or]: [
            { category_id: article.category_id },
            tagIds.length > 0 ? {
              '$tags.id$': { [req.models.News.sequelize.Sequelize.Op.in]: tagIds }
            } : {}
          ]
        },
        include: [
          {
            model: req.models.User,
            as: 'author',
            attributes: ['id', 'first_name', 'last_name']
          },
          {
            model: req.models.Category,
            as: 'category',
            attributes: ['id', 'name', 'slug']
          },
          {
            model: req.models.Tag,
            as: 'tags',
            attributes: ['id', 'name', 'slug'],
            through: { attributes: [] }
          }
        ],
        order: [['published_at', 'DESC']],
        limit,
        distinct: true
      });

      res.json({
        success: true,
        data: {
          related_articles: relatedArticles,
          count: relatedArticles.length
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch related articles'
      });
    }
  }
);

module.exports = router;