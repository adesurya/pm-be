// controllers/tagController.js
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { sanitizeHtmlContent } = require('../middleware/security');

/**
 * Get all tags
 */
const getAllTags = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      active = 'true',
      min_usage = 0
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    // Build where clause
    const where = {};
    
    if (active === 'true') {
      where.is_active = true;
    }
    
    if (min_usage > 0) {
      where.usage_count = {
        [Op.gte]: parseInt(min_usage)
      };
    }
    
    if (search) {
      where.name = {
        [Op.like]: `%${search}%`
      };
    }

    const { count, rows: tags } = await req.models.Tag.findAndCountAll({
      where,
      order: [['usage_count', 'DESC'], ['name', 'ASC']],
      limit: pageLimit,
      offset
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        tags,
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
    logger.error('Get all tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tags'
    });
  }
};

/**
 * Get popular tags
 */
const getPopularTags = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const tags = await req.models.Tag.getPopular(parseInt(limit));

    res.json({
      success: true,
      data: {
        tags
      }
    });

  } catch (error) {
    logger.error('Get popular tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular tags'
    });
  }
};

/**
 * Get trending tags
 */
const getTrendingTags = async (req, res) => {
  try {
    const { limit = 10, days = 30 } = req.query;

    const tags = await req.models.Tag.getTrending(parseInt(limit), parseInt(days));

    res.json({
      success: true,
      data: {
        tags
      }
    });

  } catch (error) {
    logger.error('Get trending tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending tags'
    });
  }
};

/**
 * Get tag cloud
 */
const getTagCloud = async (req, res) => {
  try {
    const { min_count = 1 } = req.query;

    const tags = await req.models.Tag.getCloud(parseInt(min_count));

    // Calculate font sizes for tag cloud
    const maxUsage = Math.max(...tags.map(tag => tag.usage_count));
    const minUsage = Math.min(...tags.map(tag => tag.usage_count));
    
    const tagCloud = tags.map(tag => ({
      ...tag.toJSON(),
      font_size: calculateFontSize(tag.usage_count, minUsage, maxUsage)
    }));

    res.json({
      success: true,
      data: {
        tags: tagCloud,
        statistics: {
          total_tags: tags.length,
          max_usage: maxUsage,
          min_usage: minUsage
        }
      }
    });

  } catch (error) {
    logger.error('Get tag cloud error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tag cloud'
    });
  }
};

/**
 * Get tag statistics
 */
const getTagStats = async (req, res) => {
  try {
    const stats = await req.models.Tag.getStatistics();

    res.json({
      success: true,
      data: {
        statistics: stats
      }
    });

  } catch (error) {
    logger.error('Get tag statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tag statistics'
    });
  }
};

/**
 * Get single tag by ID or slug
 */
const getTagById = async (req, res) => {
  try {
    const identifier = req.params.id;
    
    // Check if identifier is UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    
    const whereClause = isUUID ? { id: identifier } : { slug: identifier };
    
    const tag = await req.models.Tag.findOne({
      where: { ...whereClause, is_active: true }
    });

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
        code: 'TAG_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        tag
      }
    });

  } catch (error) {
    logger.error('Get tag by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tag'
    });
  }
};

/**
 * Get unused tags
 */
const getUnusedTags = async (req, res) => {
  try {
    const tags = await req.models.Tag.getUnused();

    res.json({
      success: true,
      data: {
        tags,
        count: tags.length
      }
    });

  } catch (error) {
    logger.error('Get unused tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unused tags'
    });
  }
};

/**
 * Create new tag
 */
const createTag = async (req, res) => {
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
      name,
      description,
      color,
      meta_title,
      meta_description
    } = req.body;

    // Check tag limit
    const tagCount = await req.models.Tag.count();
    if (tagCount >= req.tenant.limits.max_tags) {
      return res.status(402).json({
        success: false,
        message: `Tag limit exceeded. Maximum allowed: ${req.tenant.limits.max_tags}`,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Check if tag name already exists
    const existingTag = await req.models.Tag.findByName(name.toLowerCase().trim());

    if (existingTag) {
      return res.status(409).json({
        success: false,
        message: 'Tag with this name already exists',
        code: 'TAG_EXISTS'
      });
    }

    // Sanitize data
    const tagData = {
      name: sanitizeHtmlContent(name).toLowerCase().trim(),
      description: description ? sanitizeHtmlContent(description) : null,
      color: color || getRandomColor(),
      meta_title: meta_title ? sanitizeHtmlContent(meta_title) : null,
      meta_description: meta_description ? sanitizeHtmlContent(meta_description) : null
    };

    // Create tag
    const tag = await req.models.Tag.create(tagData);

    logger.info(`Tag created: ${tag.name} by ${req.currentUser.email}`);

    res.status(201).json({
      success: true,
      message: 'Tag created successfully',
      data: {
        tag
      }
    });

  } catch (error) {
    logger.error('Create tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create tag'
    });
  }
};

/**
 * Update tag
 */
const updateTag = async (req, res) => {
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

    const tagId = req.params.id;
    const tag = await req.models.Tag.findByPk(tagId);

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
        code: 'TAG_NOT_FOUND'
      });
    }

    const {
      name,
      description,
      color,
      is_active,
      meta_title,
      meta_description
    } = req.body;

    // Check for name conflicts (excluding current tag)
    if (name && name.toLowerCase().trim() !== tag.name) {
      const existingTag = await req.models.Tag.findOne({
        where: {
          name: name.toLowerCase().trim(),
          id: { [Op.ne]: tagId }
        }
      });

      if (existingTag) {
        return res.status(409).json({
          success: false,
          message: 'Tag with this name already exists',
          code: 'TAG_EXISTS'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = sanitizeHtmlContent(name).toLowerCase().trim();
    if (description !== undefined) updateData.description = description ? sanitizeHtmlContent(description) : null;
    if (color !== undefined) updateData.color = color;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (meta_title !== undefined) updateData.meta_title = meta_title ? sanitizeHtmlContent(meta_title) : null;
    if (meta_description !== undefined) updateData.meta_description = meta_description ? sanitizeHtmlContent(meta_description) : null;

    // Update tag
    await tag.update(updateData);

    logger.info(`Tag updated: ${tag.name} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Tag updated successfully',
      data: {
        tag
      }
    });

  } catch (error) {
    logger.error('Update tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update tag'
    });
  }
};

/**
 * Delete tag
 */
const deleteTag = async (req, res) => {
  try {
    const tagId = req.params.id;
    const tag = await req.models.Tag.findByPk(tagId);

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
        code: 'TAG_NOT_FOUND'
      });
    }

    // Check if tag is being used
    if (tag.usage_count > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete tag that is used in ${tag.usage_count} articles`,
        code: 'TAG_IN_USE'
      });
    }

    const tagName = tag.name;
    
    // Delete tag
    await tag.destroy();

    logger.info(`Tag deleted: ${tagName} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Tag deleted successfully'
    });

  } catch (error) {
    logger.error('Delete tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tag'
    });
  }
};

/**
 * Clean up unused tags
 */
const cleanupTags = async (req, res) => {
  try {
    const { min_usage = 0, older_than_days = 30 } = req.body;

    const deletedCount = await req.models.Tag.cleanup(parseInt(min_usage), parseInt(older_than_days));

    logger.info(`Tag cleanup completed: ${deletedCount} tags deleted by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Tag cleanup completed successfully',
      data: {
        deleted_count: deletedCount
      }
    });

  } catch (error) {
    logger.error('Tag cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup tags'
    });
  }
};

/**
 * Bulk update usage counts
 */
const bulkUpdateUsageCounts = async (req, res) => {
  try {
    await req.models.Tag.bulkUpdateUsageCounts();

    logger.info(`Tag usage counts updated by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Tag usage counts updated successfully'
    });

  } catch (error) {
    logger.error('Bulk update usage counts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update usage counts'
    });
  }
};

/**
 * Helper function to calculate font size for tag cloud
 */
const calculateFontSize = (usage, minUsage, maxUsage) => {
  const minSize = 12;
  const maxSize = 24;
  
  if (maxUsage === minUsage) {
    return minSize;
  }
  
  const ratio = (usage - minUsage) / (maxUsage - minUsage);
  return Math.round(minSize + (maxSize - minSize) * ratio);
};

/**
 * Helper function to get random color
 */
const getRandomColor = () => {
  const colors = [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
    '#8B5CF6', '#06B6D4', '#84CC16', '#F97316',
    '#EC4899', '#6B7280', '#14B8A6', '#F43F5E'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

module.exports = {
  getAllTags,
  getPopularTags,
  getTrendingTags,
  getTagCloud,
  getTagStats,
  getTagById,
  getUnusedTags,
  createTag,
  updateTag,
  deleteTag,
  cleanupTags,
  bulkUpdateUsageCounts
};