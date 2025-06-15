// models/News.js
const { DataTypes } = require('sequelize');
const slugify = require('slugify');

module.exports = (sequelize) => {
  const News = sequelize.define('News', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [5, 255]
      }
    },
    slug: {
      type: DataTypes.STRING(300),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true
      }
    },
    excerpt: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 500]
      }
    },
    content: {
      type: DataTypes.TEXT('long'),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [10, 65535]
      }
    },
    content_html: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },
    featured_image: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    featured_image_alt: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('draft', 'review', 'published', 'archived'),
      defaultValue: 'draft',
      allowNull: false
    },
    visibility: {
      type: DataTypes.ENUM('public', 'private', 'password'),
      defaultValue: 'public',
      allowNull: false
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    category_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'categories',
        key: 'id'
      }
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    views_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    likes_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    comments_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    shares_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    reading_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Estimated reading time in minutes'
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
    social_image: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    custom_fields: {
      type: DataTypes.JSON,
      defaultValue: {},
      allowNull: true
    },
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false
    },
    is_featured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    is_breaking: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    allow_comments: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
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
    tableName: 'news',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['slug']
      },
      {
        fields: ['status']
      },
      {
        fields: ['author_id']
      },
      {
        fields: ['category_id']
      },
      {
        fields: ['published_at']
      },
      {
        fields: ['is_featured']
      },
      {
        fields: ['is_breaking']
      },
      {
        fields: ['created_at']
      }
    ],
    hooks: {
      beforeCreate: async (news) => {
        // Generate slug from title
        if (!news.slug && news.title) {
          news.slug = await News.generateUniqueSlug(news.title);
        }
        
        // Calculate reading time
        if (news.content) {
          news.reading_time = News.calculateReadingTime(news.content);
        }
        
        // Set published_at if status is published
        if (news.status === 'published' && !news.published_at) {
          news.published_at = new Date();
        }
      },
      
      beforeUpdate: async (news) => {
        // Update slug if title changed
        if (news.changed('title') && news.title) {
          news.slug = await News.generateUniqueSlug(news.title, news.id);
        }
        
        // Recalculate reading time if content changed
        if (news.changed('content') && news.content) {
          news.reading_time = News.calculateReadingTime(news.content);
        }
        
        // Set published_at when status changes to published
        if (news.changed('status') && news.status === 'published' && !news.published_at) {
          news.published_at = new Date();
        }
        
        // Clear published_at if status changes from published
        if (news.changed('status') && news.status !== 'published' && news.published_at) {
          news.published_at = null;
        }
        
        news.updated_at = new Date();
      }
    }
  });

  // Instance methods
  News.prototype.isPublished = function() {
    return this.status === 'published' && this.published_at && this.published_at <= new Date();
  };

  News.prototype.canBeViewedByPublic = function() {
    return this.isPublished() && this.visibility === 'public';
  };

  News.prototype.getUrl = function() {
    return `/news/${this.slug}`;
  };

  News.prototype.incrementViews = async function() {
    this.views_count += 1;
    await this.save({ fields: ['views_count'] });
  };

  News.prototype.incrementLikes = async function() {
    this.likes_count += 1;
    await this.save({ fields: ['likes_count'] });
  };

  News.prototype.incrementShares = async function() {
    this.shares_count += 1;
    await this.save({ fields: ['shares_count'] });
  };

  // Class methods
  News.generateUniqueSlug = async function(title, excludeId = null) {
    let baseSlug = slugify(title, {
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

  News.calculateReadingTime = function(content) {
    const wordsPerMinute = 200;
    const words = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
  };

  News.findPublished = async function(options = {}) {
    return await this.findAll({
      where: {
        status: 'published',
        published_at: {
          [sequelize.Sequelize.Op.lte]: new Date()
        },
        ...options.where
      },
      order: [['published_at', 'DESC']],
      ...options
    });
  };

  News.findBySlug = async function(slug) {
    return await this.findOne({
      where: { slug },
      include: [
        {
          association: 'author',
          attributes: ['id', 'first_name', 'last_name', 'avatar']
        },
        {
          association: 'category',
          attributes: ['id', 'name', 'slug']
        },
        {
          association: 'tags',
          attributes: ['id', 'name', 'slug'],
          through: { attributes: [] }
        }
      ]
    });
  };

  News.findFeatured = async function(limit = 5) {
    return await this.findPublished({
      where: { is_featured: true },
      limit,
      order: [['published_at', 'DESC']]
    });
  };

  News.findBreaking = async function(limit = 3) {
    return await this.findPublished({
      where: { is_breaking: true },
      limit,
      order: [['published_at', 'DESC']]
    });
  };

  News.findByCategory = async function(categoryId, options = {}) {
    return await this.findPublished({
      where: { category_id: categoryId },
      ...options
    });
  };

  News.findByAuthor = async function(authorId, options = {}) {
    return await this.findPublished({
      where: { author_id: authorId },
      ...options
    });
  };

  News.search = async function(query, options = {}) {
    return await this.findPublished({
      where: {
        [sequelize.Sequelize.Op.or]: [
          {
            title: {
              [sequelize.Sequelize.Op.like]: `%${query}%`
            }
          },
          {
            content: {
              [sequelize.Sequelize.Op.like]: `%${query}%`
            }
          },
          {
            excerpt: {
              [sequelize.Sequelize.Op.like]: `%${query}%`
            }
          }
        ]
      },
      ...options
    });
  };

  News.getStatusCounts = async function() {
    const counts = await this.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });
    
    return counts.reduce((acc, item) => {
      acc[item.status] = parseInt(item.count);
      return acc;
    }, {});
  };

  News.getPopular = async function(limit = 10, days = 7) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    
    return await this.findPublished({
      where: {
        published_at: {
          [sequelize.Sequelize.Op.gte]: dateLimit
        }
      },
      order: [['views_count', 'DESC']],
      limit
    });
  };

  return News;
};