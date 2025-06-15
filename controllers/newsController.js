// controllers/newsController.js
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { sanitizeHtmlContent } = require('../middleware/security');

/**
 * Get all news articles with pagination and filters
 */
const getAllNews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      category_id,
      author_id,
      search,
      sort = 'created_at',
      order = 'DESC',
      featured,
      breaking
    } = req.query;

    // Parse pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100); // Max 100 items per page

    // Build where clause
    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (category_id) {
      where.category_id = category_id;
    }
    
    if (author_id) {
      where.author_id = author_id;
    }
    
    if (featured === 'true') {
      where.is_featured = true;
    }
    
    if (breaking === 'true') {
      where.is_breaking = true;
    }
    
    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { content: { [Op.like]: `%${search}%` } },
        { excerpt: { [Op.like]: `%${search}%` } }
      ];
    }

    // For non-admin users, only show their own articles or published ones
    if (!['super_admin', 'admin'].includes(req.currentUser.role)) {
      if (req.currentUser.role === 'contributor') {
        where[Op.or] = [
          { author_id: req.currentUser.id },
          { status: 'published', visibility: 'public' }
        ];
      } else if (req.currentUser.role === 'editor') {
        where[Op.or] = [
          { author_id: req.currentUser.id },
          { status: { [Op.in]: ['published', 'review'] } }
        ];
      }
    }

    // Get articles with associations
    const { count, rows: articles } = await req.models.News.findAndCountAll({
      where,
      include: [
        {
          model: req.models.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name', 'email', 'avatar']
        },
        {
          model: req.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug', 'color']
        },
        {
          model: req.models.Tag,
          as: 'tags',
          attributes: ['id', 'name', 'slug', 'color'],
          through: { attributes: [] }
        }
      ],
      order: [[sort, order.toUpperCase()]],
      limit: pageLimit,
      offset,
      distinct: true
    });

    // Calculate pagination info
    const totalPages = Math.ceil(count / pageLimit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: count,
          items_per_page: pageLimit,
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage
        }
      }
    });

  } catch (error) {
    logger.error('Get all news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch news articles'
    });
  }
};

/**
 * Get single news article by ID or slug
 */
const getNewsById = async (req, res) => {
  try {
    const identifier = req.params.id;
    
    // Check if identifier is UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    
    const whereClause = isUUID ? { id: identifier } : { slug: identifier };
    
    const article = await req.models.News.findOne({
      where: whereClause,
      include: [
        {
          model: req.models.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name', 'email', 'avatar', 'bio']
        },
        {
          model: req.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug', 'color', 'description']
        },
        {
          model: req.models.Tag,
          as: 'tags',
          attributes: ['id', 'name', 'slug', 'color'],
          through: { attributes: [] }
        }
      ]
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND'
      });
    }

    // Check permissions
    const canView = 
      article.status === 'published' ||
      article.author_id === req.currentUser.id ||
      ['super_admin', 'admin', 'editor'].includes(req.currentUser.role);

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this article',
        code: 'ACCESS_DENIED'
      });
    }

    // Increment view count for published articles
    if (article.status === 'published' && article.visibility === 'public') {
      await article.incrementViews();
    }

    res.json({
      success: true,
      data: {
        article
      }
    });

  } catch (error) {
    logger.error('Get news by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch article'
    });
  }
};

/**
 * Create new news article
 */
const createNews = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      title,
      content,
      excerpt,
      category_id,
      tags = [],
      status = 'draft',
      visibility = 'public',
      featured_image,
      featured_image_alt,
      meta_title,
      meta_description,
      meta_keywords,
      is_featured = false,
      is_breaking = false,
      allow_comments = true,
      scheduled_at,
      custom_fields = {}
    } = req.body;

    // Check article limit
    const articleCount = await req.models.News.count();
    if (!req.tenant.canCreateArticle(articleCount)) {
      return res.status(402).json({
        success: false,
        message: `Article limit exceeded. Maximum allowed: ${req.tenant.limits.max_articles}`,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Check if user can publish
    const finalStatus = (status === 'published' && !req.currentUser.canPublish()) 
      ? 'review' 
      : status;

    // Sanitize content
    const sanitizedData = {
      title: sanitizeHtmlContent(title).trim(),
      content: sanitizeHtmlContent(content),
      excerpt: excerpt ? sanitizeHtmlContent(excerpt) : null,
      category_id,
      status: finalStatus,
      visibility,
      featured_image,
      featured_image_alt: featured_image_alt ? sanitizeHtmlContent(featured_image_alt) : null,
      meta_title: meta_title ? sanitizeHtmlContent(meta_title) : null,
      meta_description: meta_description ? sanitizeHtmlContent(meta_description) : null,
      meta_keywords: meta_keywords ? sanitizeHtmlContent(meta_keywords) : null,
      is_featured: ['super_admin', 'admin', 'editor'].includes(req.currentUser.role) ? is_featured : false,
      is_breaking: ['super_admin', 'admin'].includes(req.currentUser.role) ? is_breaking : false,
      allow_comments,
      scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
      custom_fields,
      author_id: req.currentUser.id
    };

    // Create article
    const article = await req.models.News.create(sanitizedData);

    // Handle tags
    if (tags.length > 0) {
      const tagObjects = await req.models.Tag.findOrCreate(tags);
      await article.setTags(tagObjects);
    }

    // Fetch created article with associations
    const createdArticle = await req.models.News.findByPk(article.id, {
      include: [
        {
          model: req.models.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name', 'email', 'avatar']
        },
        {
          model: req.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug', 'color']
        },
        {
          model: req.models.Tag,
          as: 'tags',
          attributes: ['id', 'name', 'slug', 'color'],
          through: { attributes: [] }
        }
      ]
    });

    logger.info(`Article created: ${article.title} by ${req.currentUser.email}`);

    res.status(201).json({
      success: true,
      message: 'Article created successfully',
      data: {
        article: createdArticle
      }
    });

  } catch (error) {
    logger.error('Create news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create article'
    });
  }
};

/**
 * Update news article
 */
const updateNews = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const articleId = req.params.id;
    const article = await req.models.News.findByPk(articleId);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND'
      });
    }

    // Check permissions
    const canEdit = 
      article.author_id === req.currentUser.id ||
      ['super_admin', 'admin', 'editor'].includes(req.currentUser.role);

    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this article',
        code: 'ACCESS_DENIED'
      });
    }

    const {
      title,
      content,
      excerpt,
      category_id,
      tags,
      status,
      visibility,
      featured_image,
      featured_image_alt,
      meta_title,
      meta_description,
      meta_keywords,
      is_featured,
      is_breaking,
      allow_comments,
      scheduled_at,
      custom_fields
    } = req.body;

    // Check if user can publish
    let finalStatus = status;
    if (status === 'published' && !req.currentUser.canPublish()) {
      finalStatus = 'review';
    }

    // Build update data
    const updateData = {};
    if (title !== undefined) updateData.title = sanitizeHtmlContent(title).trim();
    if (content !== undefined) updateData.content = sanitizeHtmlContent(content);
    if (excerpt !== undefined) updateData.excerpt = excerpt ? sanitizeHtmlContent(excerpt) : null;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (status !== undefined) updateData.status = finalStatus;
    if (visibility !== undefined) updateData.visibility = visibility;
    if (featured_image !== undefined) updateData.featured_image = featured_image;
    if (featured_image_alt !== undefined) updateData.featured_image_alt = featured_image_alt ? sanitizeHtmlContent(featured_image_alt) : null;
    if (meta_title !== undefined) updateData.meta_title = meta_title ? sanitizeHtmlContent(meta_title) : null;
    if (meta_description !== undefined) updateData.meta_description = meta_description ? sanitizeHtmlContent(meta_description) : null;
    if (meta_keywords !== undefined) updateData.meta_keywords = meta_keywords ? sanitizeHtmlContent(meta_keywords) : null;
    if (allow_comments !== undefined) updateData.allow_comments = allow_comments;
    if (scheduled_at !== undefined) updateData.scheduled_at = scheduled_at ? new Date(scheduled_at) : null;
    if (custom_fields !== undefined) updateData.custom_fields = custom_fields;

    // Only admins and editors can set featured/breaking
    if (['super_admin', 'admin', 'editor'].includes(req.currentUser.role)) {
      if (is_featured !== undefined) updateData.is_featured = is_featured;
    }
    if (['super_admin', 'admin'].includes(req.currentUser.role)) {
      if (is_breaking !== undefined) updateData.is_breaking = is_breaking;
    }

    // Update article
    await article.update(updateData);

    // Handle tags if provided
    if (tags !== undefined) {
      if (tags.length > 0) {
        const tagObjects = await req.models.Tag.findOrCreate(tags);
        await article.setTags(tagObjects);
      } else {
        await article.setTags([]);
      }
    }

    // Fetch updated article with associations
    const updatedArticle = await req.models.News.findByPk(article.id, {
      include: [
        {
          model: req.models.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name', 'email', 'avatar']
        },
        {
          model: req.models.Category,
          as: 'category',
          attributes: ['id', 'name', 'slug', 'color']
        },
        {
          model: req.models.Tag,
          as: 'tags',
          attributes: ['id', 'name', 'slug', 'color'],
          through: { attributes: [] }
        }
      ]
    });

    logger.info(`Article updated: ${article.title} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Article updated successfully',
      data: {
        article: updatedArticle
      }
    });

  } catch (error) {
    logger.error('Update news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update article'
    });
  }
};

/**
 * Delete news article
 */
const deleteNews = async (req, res) => {
  try {
    const articleId = req.params.id;
    const article = await req.models.News.findByPk(articleId);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND'
      });
    }

    // Check permissions
    const canDelete = 
      article.author_id === req.currentUser.id ||
      ['super_admin', 'admin'].includes(req.currentUser.role) ||
      (req.currentUser.role === 'editor' && article.status !== 'published');

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this article',
        code: 'ACCESS_DENIED'
      });
    }

    // Store article title for logging
    const articleTitle = article.title;

    // Delete article (tags will be automatically removed due to cascade)
    await article.destroy();

    logger.info(`Article deleted: ${articleTitle} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Article deleted successfully'
    });

  } catch (error) {
    logger.error('Delete news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete article'
    });
  }
};

/**
 * Publish/unpublish article
 */
const togglePublishStatus = async (req, res) => {
  try {
    const articleId = req.params.id;
    const { action } = req.body; // 'publish' or 'unpublish'

    const article = await req.models.News.findByPk(articleId);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found',
        code: 'ARTICLE_NOT_FOUND'
      });
    }

    // Check permissions
    if (!req.currentUser.canPublish()) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to publish articles',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    let newStatus;
    if (action === 'publish') {
      newStatus = 'published';
    } else if (action === 'unpublish') {
      newStatus = 'draft';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "publish" or "unpublish"'
      });
    }

    await article.update({ status: newStatus });

    logger.info(`Article ${action}ed: ${article.title} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: `Article ${action}ed successfully`,
      data: {
        article: {
          id: article.id,
          title: article.title,
          status: article.status,
          published_at: article.published_at
        }
      }
    });

  } catch (error) {
    logger.error('Toggle publish status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update article status'
    });
  }
};

/**
 * Get published articles for public view
 */
const getPublishedNews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      category_id,
      tag_id,
      search,
      sort = 'published_at',
      featured,
      breaking
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 50);

    // Build where clause for published articles
    const where = {
      status: 'published',
      visibility: 'public',
      published_at: {
        [Op.lte]: new Date()
      }
    };

    if (category_id) {
      where.category_id = category_id;
    }

    if (featured === 'true') {
      where.is_featured = true;
    }

    if (breaking === 'true') {
      where.is_breaking = true;
    }

    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { excerpt: { [Op.like]: `%${search}%` } }
      ];
    }

    // Include tag filter
    const include = [
      {
        model: req.models.User,
        as: 'author',
        attributes: ['id', 'first_name', 'last_name', 'avatar']
      },
      {
        model: req.models.Category,
        as: 'category',
        attributes: ['id', 'name', 'slug', 'color']
      },
      {
        model: req.models.Tag,
        as: 'tags',
        attributes: ['id', 'name', 'slug', 'color'],
        through: { attributes: [] }
      }
    ];

    // Add tag filter if specified
    if (tag_id) {
      include[2].where = { id: tag_id };
      include[2].required = true;
    }

    const { count, rows: articles } = await req.models.News.findAndCountAll({
      where,
      include,
      order: [[sort, 'DESC']],
      limit: pageLimit,
      offset,
      distinct: true
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: count,
          items_per_page: pageLimit,
          has_next_page: page < totalPages,
          has_prev_page: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get published news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch published articles'
    });
  }
};

/**
 * Get featured articles
 */
const getFeaturedNews = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const articles = await req.models.News.findFeatured(parseInt(limit));

    res.json({
      success: true,
      data: {
        articles
      }
    });

  } catch (error) {
    logger.error('Get featured news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch featured articles'
    });
  }
};

/**
 * Get breaking news
 */
const getBreakingNews = async (req, res) => {
  try {
    const { limit = 3 } = req.query;

    const articles = await req.models.News.findBreaking(parseInt(limit));

    res.json({
      success: true,
      data: {
        articles
      }
    });

  } catch (error) {
    logger.error('Get breaking news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch breaking news'
    });
  }
};

/**
 * Get popular articles
 */
const getPopularNews = async (req, res) => {
  try {
    const { limit = 10, days = 7 } = req.query;

    const articles = await req.models.News.getPopular(parseInt(limit), parseInt(days));

    res.json({
      success: true,
      data: {
        articles
      }
    });

  } catch (error) {
    logger.error('Get popular news error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular articles'
    });
  }
};

/**
 * Get news statistics
 */
const getNewsStats = async (req, res) => {
  try {
    // Only admins and editors can view stats
    if (!['super_admin', 'admin', 'editor'].includes(req.currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'ACCESS_DENIED'
      });
    }

    const [statusCounts, totalViews, totalArticles] = await Promise.all([
      req.models.News.getStatusCounts(),
      req.models.News.sum('views_count'),
      req.models.News.count()
    ]);

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentArticles = await req.models.News.count({
      where: {
        created_at: {
          [Op.gte]: thirtyDaysAgo
        }
      }
    });

    const recentPublished = await req.models.News.count({
      where: {
        status: 'published',
        published_at: {
          [Op.gte]: thirtyDaysAgo
        }
      }
    });

    res.json({
      success: true,
      data: {
        status_counts: statusCounts,
        total_views: totalViews || 0,
        total_articles: totalArticles,
        recent_activity: {
          articles_created: recentArticles,
          articles_published: recentPublished
        }
      }
    });

  } catch (error) {
    logger.error('Get news stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch news statistics'
    });
  }
};

/**
 * Bulk operations on articles
 */
const bulkOperations = async (req, res) => {
  try {
    const { action, article_ids } = req.body;

    if (!Array.isArray(article_ids) || article_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Article IDs array is required'
      });
    }

    // Check permissions
    if (!['super_admin', 'admin', 'editor'].includes(req.currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions for bulk operations'
      });
    }

    let result;
    
    switch (action) {
      case 'publish':
        if (!req.currentUser.canPublish()) {
          return res.status(403).json({
            success: false,
            message: 'You cannot publish articles'
          });
        }
        result = await req.models.News.update(
          { status: 'published' },
          { where: { id: { [Op.in]: article_ids } } }
        );
        break;

      case 'unpublish':
        result = await req.models.News.update(
          { status: 'draft' },
          { where: { id: { [Op.in]: article_ids } } }
        );
        break;

      case 'delete':
        if (!['super_admin', 'admin'].includes(req.currentUser.role)) {
          return res.status(403).json({
            success: false,
            message: 'Only admins can perform bulk delete'
          });
        }
        result = await req.models.News.destroy({
          where: { id: { [Op.in]: article_ids } }
        });
        break;

      case 'feature':
        result = await req.models.News.update(
          { is_featured: true },
          { where: { id: { [Op.in]: article_ids } } }
        );
        break;

      case 'unfeature':
        result = await req.models.News.update(
          { is_featured: false },
          { where: { id: { [Op.in]: article_ids } } }
        );
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid bulk action'
        });
    }

    logger.info(`Bulk ${action} performed on ${article_ids.length} articles by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: `Bulk ${action} completed successfully`,
      data: {
        affected_count: Array.isArray(result) ? result[0] : result
      }
    });

  } catch (error) {
    logger.error('Bulk operations error:', error);
    res.status(500).json({
      success: false,
      message: 'Bulk operation failed'
    });
  }
};

module.exports = {
  getAllNews,
  getNewsById,
  createNews,
  updateNews,
  deleteNews,
  togglePublishStatus,
  getPublishedNews,
  getFeaturedNews,
  getBreakingNews,
  getPopularNews,
  getNewsStats,
  bulkOperations
};