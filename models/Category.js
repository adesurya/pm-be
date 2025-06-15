// models/Category.js
const { DataTypes } = require('sequelize');
const slugify = require('slugify');

module.exports = (sequelize) => {
  const Category = sequelize.define('Category', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [2, 100]
      }
    },
    slug: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      validate: {
        is: /^#[0-9A-F]{6}$/i
      }
    },
    image: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    parent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'categories',
        key: 'id'
      }
    },
    sort_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    is_featured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    posts_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    meta_title: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    meta_description: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    meta_keywords: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    }
  }, {
    tableName: 'categories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['name']
      },
      {
        unique: true,
        fields: ['slug']
      },
      {
        fields: ['parent_id']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['is_featured']
      },
      {
        fields: ['sort_order']
      }
    ],
    hooks: {
      beforeCreate: async (category) => {
        // Generate slug from name
        if (!category.slug && category.name) {
          category.slug = await Category.generateUniqueSlug(category.name);
        }
      },
      
      beforeUpdate: async (category) => {
        // Update slug if name changed
        if (category.changed('name') && category.name) {
          category.slug = await Category.generateUniqueSlug(category.name, category.id);
        }
        
        category.updated_at = new Date();
      }
    }
  });

  // Self-referential association for parent-child relationships
  Category.hasMany(Category, { 
    as: 'children', 
    foreignKey: 'parent_id',
    onDelete: 'SET NULL'
  });
  
  Category.belongsTo(Category, { 
    as: 'parent', 
    foreignKey: 'parent_id' 
  });

  // Instance methods
  Category.prototype.getUrl = function() {
    return `/category/${this.slug}`;
  };

  Category.prototype.isParent = function() {
    return this.parent_id === null;
  };

  Category.prototype.hasChildren = async function() {
    const children = await this.getChildren();
    return children.length > 0;
  };

  Category.prototype.getFullPath = async function() {
    const path = [this.name];
    let current = this;
    
    while (current.parent_id) {
      current = await Category.findByPk(current.parent_id);
      if (current) {
        path.unshift(current.name);
      }
    }
    
    return path.join(' > ');
  };

  Category.prototype.incrementPostsCount = async function() {
    this.posts_count += 1;
    await this.save({ fields: ['posts_count'] });
  };

  Category.prototype.decrementPostsCount = async function() {
    if (this.posts_count > 0) {
      this.posts_count -= 1;
      await this.save({ fields: ['posts_count'] });
    }
  };

  // Class methods
  Category.generateUniqueSlug = async function(name, excludeId = null) {
    let baseSlug = slugify(name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });
    
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      const whereClause = { slug };
      if (excludeId) {
        whereClause.id = { [sequelize.Sequelize.Op.ne]: excludeId };
      }
      
      const existing = await this.findOne({ where: whereClause });
      if (!existing) {
        return slug;
      }
      
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  };

  Category.findActive = async function(options = {}) {
    return await this.findAll({
      where: {
        is_active: true,
        ...options.where
      },
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
      ...options
    });
  };

  Category.findBySlug = async function(slug) {
    return await this.findOne({
      where: { 
        slug,
        is_active: true
      },
      include: [
        {
          model: Category,
          as: 'parent',
          attributes: ['id', 'name', 'slug']
        },
        {
          model: Category,
          as: 'children',
          where: { is_active: true },
          required: false,
          attributes: ['id', 'name', 'slug', 'posts_count']
        }
      ]
    });
  };

  Category.findParents = async function() {
    return await this.findActive({
      where: { parent_id: null }
    });
  };

  Category.findChildren = async function(parentId) {
    return await this.findActive({
      where: { parent_id: parentId }
    });
  };

  Category.findFeatured = async function() {
    return await this.findActive({
      where: { is_featured: true }
    });
  };

  Category.buildTree = async function() {
    const categories = await this.findActive({
      include: [
        {
          model: Category,
          as: 'children',
          where: { is_active: true },
          required: false
        }
      ]
    });
    
    return categories.filter(cat => cat.parent_id === null);
  };

  Category.findWithPostCounts = async function() {
    return await this.findActive({
      attributes: [
        'id',
        'name',
        'slug',
        'posts_count',
        [sequelize.literal('(SELECT COUNT(*) FROM news WHERE category_id = Category.id AND status = "published")'), 'published_posts_count']
      ]
    });
  };

  Category.getHierarchy = async function() {
    const categories = await this.findAll({
      where: { is_active: true },
      order: [['parent_id', 'ASC'], ['sort_order', 'ASC'], ['name', 'ASC']]
    });
    
    const categoryMap = new Map();
    const rootCategories = [];
    
    // First pass: create map of all categories
    categories.forEach(cat => {
      categoryMap.set(cat.id, {
        ...cat.toJSON(),
        children: []
      });
    });
    
    // Second pass: build hierarchy
    categories.forEach(cat => {
      if (cat.parent_id) {
        const parent = categoryMap.get(cat.parent_id);
        if (parent) {
          parent.children.push(categoryMap.get(cat.id));
        }
      } else {
        rootCategories.push(categoryMap.get(cat.id));
      }
    });
    
    return rootCategories;
  };

  Category.reorderCategories = async function(categoryIds) {
    const transaction = await sequelize.transaction();
    
    try {
      for (let i = 0; i < categoryIds.length; i++) {
        await this.update(
          { sort_order: i + 1 },
          { 
            where: { id: categoryIds[i] },
            transaction
          }
        );
      }
      
      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  Category.getPopular = async function(limit = 10) {
    return await this.findActive({
      order: [['posts_count', 'DESC']],
      limit
    });
  };

  return Category;
};