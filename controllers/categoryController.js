// controllers/categoryController.js
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { sanitizeHtmlContent } = require('../middleware/security');

/**
 * Get all categories
 */
const getAllCategories = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      parent_id,
      featured,
      active = 'true',
      with_posts = 'false'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    // Build where clause
    const where = {};
    
    if (active === 'true') {
      where.is_active = true;
    }
    
    if (parent_id) {
      where.parent_id = parent_id === 'null' ? null : parent_id;
    }
    
    if (featured === 'true') {
      where.is_featured = true;
    }
    
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } }
      ];
    }

    // Include options
    const include = [];
    
    // Include parent category
    include.push({
      model: req.models.Category,
      as: 'parent',
      attributes: ['id', 'name', 'slug']
    });
    
    // Include child categories
    include.push({
      model: req.models.Category,
      as: 'children',
      attributes: ['id', 'name', 'slug', 'posts_count'],
      where: { is_active: true },
      required: false
    });

    // Include post count if requested
    if (with_posts === 'true') {
      include.push({
        model: req.models.News,
        as: 'articles',
        attributes: [],
        where: { status: 'published' },
        required: false
      });
    }

    const { count, rows: categories } = await req.models.Category.findAndCountAll({
      where,
      include,
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
      limit: pageLimit,
      offset,
      distinct: true
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        categories,
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
    logger.error('Get all categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

/**
 * Get category tree/hierarchy
 */
const getCategoryTree = async (req, res) => {
  try {
    const tree = await req.models.Category.getHierarchy();

    res.json({
      success: true,
      data: {
        categories: tree
      }
    });

  } catch (error) {
    logger.error('Get category tree error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category tree'
    });
  }
};

/**
 * Get single category by ID or slug
 */
const getCategoryById = async (req, res) => {
  try {
    const identifier = req.params.id;
    
    // Check if identifier is UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    
    const whereClause = isUUID ? { id: identifier } : { slug: identifier };
    
    const category = await req.models.Category.findOne({
      where: { ...whereClause, is_active: true },
      include: [
        {
          model: req.models.Category,
          as: 'parent',
          attributes: ['id', 'name', 'slug']
        },
        {
          model: req.models.Category,
          as: 'children',
          where: { is_active: true },
          required: false,
          attributes: ['id', 'name', 'slug', 'posts_count', 'color']
        }
      ]
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
        code: 'CATEGORY_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        category
      }
    });

  } catch (error) {
    logger.error('Get category by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category'
    });
  }
};

/**
 * Create new category
 */
const createCategory = async (req, res) => {
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
      image,
      parent_id,
      sort_order = 0,
      is_featured = false,
      meta_title,
      meta_description,
      meta_keywords
    } = req.body;

    // Check category limit
    const categoryCount = await req.models.Category.count();
    if (categoryCount >= req.tenant.limits.max_categories) {
      return res.status(402).json({
        success: false,
        message: `Category limit exceeded. Maximum allowed: ${req.tenant.limits.max_categories}`,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Check if category name already exists
    const existingCategory = await req.models.Category.findOne({
      where: { name: name.trim() }
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: 'Category with this name already exists',
        code: 'CATEGORY_EXISTS'
      });
    }

    // Validate parent category if provided
    if (parent_id) {
      const parentCategory = await req.models.Category.findByPk(parent_id);
      if (!parentCategory) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found'
        });
      }
    }

    // Sanitize data
    const categoryData = {
      name: sanitizeHtmlContent(name).trim(),
      description: description ? sanitizeHtmlContent(description) : null,
      color: color || '#3B82F6',
      image,
      parent_id: parent_id || null,
      sort_order: parseInt(sort_order),
      is_featured: ['super_admin', 'admin'].includes(req.currentUser.role) ? is_featured : false,
      meta_title: meta_title ? sanitizeHtmlContent(meta_title) : null,
      meta_description: meta_description ? sanitizeHtmlContent(meta_description) : null,
      meta_keywords: meta_keywords ? sanitizeHtmlContent(meta_keywords) : null
    };

    // Create category
    const category = await req.models.Category.create(categoryData);

    logger.info(`Category created: ${category.name} by ${req.currentUser.email}`);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: {
        category
      }
    });

  } catch (error) {
    logger.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
};

/**
 * Update category
 */
const updateCategory = async (req, res) => {
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

    const categoryId = req.params.id;
    const category = await req.models.Category.findByPk(categoryId);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
        code: 'CATEGORY_NOT_FOUND'
      });
    }

    const {
      name,
      description,
      color,
      image,
      parent_id,
      sort_order,
      is_active,
      is_featured,
      meta_title,
      meta_description,
      meta_keywords
    } = req.body;

    // Check for name conflicts (excluding current category)
    if (name && name.trim() !== category.name) {
      const existingCategory = await req.models.Category.findOne({
        where: {
          name: name.trim(),
          id: { [Op.ne]: categoryId }
        }
      });

      if (existingCategory) {
        return res.status(409).json({
          success: false,
          message: 'Category with this name already exists',
          code: 'CATEGORY_EXISTS'
        });
      }
    }

    // Validate parent category if provided
    if (parent_id && parent_id !== category.parent_id) {
      // Prevent circular references
      if (parent_id === categoryId) {
        return res.status(400).json({
          success: false,
          message: 'Category cannot be its own parent'
        });
      }

      const parentCategory = await req.models.Category.findByPk(parent_id);
      if (!parentCategory) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found'
        });
      }

      // Check if the parent is a descendant (prevent circular reference)
      const descendants = await getDescendantIds(categoryId, req.models.Category);
      if (descendants.includes(parent_id)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot set descendant as parent (circular reference)'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = sanitizeHtmlContent(name).trim();
    if (description !== undefined) updateData.description = description ? sanitizeHtmlContent(description) : null;
    if (color !== undefined) updateData.color = color;
    if (image !== undefined) updateData.image = image;
    if (parent_id !== undefined) updateData.parent_id = parent_id || null;
    if (sort_order !== undefined) updateData.sort_order = parseInt(sort_order);
    if (is_active !== undefined) updateData.is_active = is_active;
    if (meta_title !== undefined) updateData.meta_title = meta_title ? sanitizeHtmlContent(meta_title) : null;
    if (meta_description !== undefined) updateData.meta_description = meta_description ? sanitizeHtmlContent(meta_description) : null;
    if (meta_keywords !== undefined) updateData.meta_keywords = meta_keywords ? sanitizeHtmlContent(meta_keywords) : null;

    // Only admins can set featured status
    if (['super_admin', 'admin'].includes(req.currentUser.role)) {
      if (is_featured !== undefined) updateData.is_featured = is_featured;
    }

    // Update category
    await category.update(updateData);

    logger.info(`Category updated: ${category.name} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: {
        category
      }
    });

  } catch (error) {
    logger.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category'
    });
  }
};

/**
 * Delete category
 */
const deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const category = await req.models.Category.findByPk(categoryId);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
        code: 'CATEGORY_NOT_FOUND'
      });
    }

    // Check if category has articles
    const articleCount = await req.models.News.count({
      where: { category_id: categoryId }
    });

    if (articleCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete category with ${articleCount} articles. Please reassign or delete articles first.`,
        code: 'CATEGORY_HAS_ARTICLES'
      });
    }

    // Check if category has children
    const hasChildren = await category.hasChildren();
    if (hasChildren) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete category with subcategories. Please delete subcategories first.',
        code: 'CATEGORY_HAS_CHILDREN'
      });
    }

    const categoryName = category.name;
    
    // Delete category
    await category.destroy();

    logger.info(`Category deleted: ${categoryName} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    logger.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
};

/**
 * Get categories with post counts
 */
const getCategoriesWithCounts = async (req, res) => {
  try {
    const categories = await req.models.Category.findWithPostCounts();

    res.json({
      success: true,
      data: {
        categories
      }
    });

  } catch (error) {
    logger.error('Get categories with counts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories with counts'
    });
  }
};

/**
 * Reorder categories
 */
const reorderCategories = async (req, res) => {
  try {
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids) || category_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Category IDs array is required'
      });
    }

    await req.models.Category.reorderCategories(category_ids);

    logger.info(`Categories reordered by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });

  } catch (error) {
    logger.error('Reorder categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder categories'
    });
  }
};

/**
 * Get popular categories
 */
const getPopularCategories = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const categories = await req.models.Category.getPopular(parseInt(limit));

    res.json({
      success: true,
      data: {
        categories
      }
    });

  } catch (error) {
    logger.error('Get popular categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular categories'
    });
  }
};

/**
 * Helper function to get descendant category IDs
 */
const getDescendantIds = async (categoryId, CategoryModel) => {
  const descendants = [];
  
  const getChildren = async (parentId) => {
    const children = await CategoryModel.findAll({
      where: { parent_id: parentId },
      attributes: ['id']
    });
    
    for (const child of children) {
      descendants.push(child.id);
      await getChildren(child.id);
    }
  };
  
  await getChildren(categoryId);
  return descendants;
};

module.exports = {
  getAllCategories,
  getCategoryTree,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoriesWithCounts,
  reorderCategories,
  getPopularCategories
};