// models/News.js - Enhanced with image support
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
    // Enhanced image fields
    featured_image: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Image ID reference'
    },
    featured_image_data: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Complete image data with all sizes'
    },
    featured_image_alt: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    // Gallery support
    gallery_images: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Array of image data objects'
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
    // SEO and performance fields
    seo_score: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: true,
      comment: 'SEO score 0-100'
    },
    readability_score: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: true,
      comment: 'Readability score 0-100'
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
      },
      {
        fields: ['views_count']
      },
      {
        fields: ['likes_count']
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

        // Generate excerpt if not provided
        if (!news.excerpt && news.content) {
          news.excerpt = News.generateExcerpt(news.content);
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

        // Update excerpt if content changed and no custom excerpt
        if (news.changed('content') && !news.excerpt && news.content) {
          news.excerpt = News.generateExcerpt(news.content);
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
    return await this.increment('views_count');
  };

  News.prototype.incrementLikes = async function() {
    return await this.increment('likes_count');
  };

  News.prototype.incrementShares = async function() {
    return await this.increment('shares_count');
  };

  // Enhanced image methods
  News.prototype.getFeaturedImageUrl = function(size = 'medium', baseUrl = null) {
    if (!this.featured_image_data || !this.featured_image_data.images) {
      return null;
    }
    
    const image = this.featured_image_data.images[size];
    if (!image) return null;
    
    const domain = baseUrl || process.env.CDN_URL || process.env.BASE_URL || 'http://localhost:3000';
    return `${domain}${image.path}`;
  };

  News.prototype.getAllImageUrls = function(baseUrl = null) {
    if (!this.featured_image_data || !this.featured_image_data.images) {
      return {};
    }
    
    const domain = baseUrl || process.env.CDN_URL || process.env.BASE_URL || 'http://localhost:3000';
    const urls = {};
    
    for (const [size, image] of Object.entries(this.featured_image_data.images)) {
      urls[size] = `${domain}${image.path}`;
    }
    
    return urls;
  };

  News.prototype.getMetaImage = function() {
    return this.social_image || this.getFeaturedImageUrl('large');
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

  News.generateExcerpt = function(content, maxLength = 200) {
    const cleanContent = content.replace(/<[^>]*>/g, '').trim();
    if (cleanContent.length <= maxLength) {
      return cleanContent;
    }
    
    const truncated = cleanContent.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    return lastSpace > 0 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
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

  // Analytics methods
  News.getEngagementStats = async function(articleId = null) {
    const whereClause = articleId ? { id: articleId } : { status: 'published' };
    
    const stats = await this.findOne({
      where: whereClause,
      attributes: [
        [sequelize.fn('AVG', sequelize.col('views_count')), 'avg_views'],
        [sequelize.fn('AVG', sequelize.col('likes_count')), 'avg_likes'],
        [sequelize.fn('AVG', sequelize.col('shares_count')), 'avg_shares'],
        [sequelize.fn('AVG', sequelize.col('comments_count')), 'avg_comments'],
        [sequelize.fn('SUM', sequelize.col('views_count')), 'total_views'],
        [sequelize.fn('SUM', sequelize.col('likes_count')), 'total_likes'],
        [sequelize.fn('SUM', sequelize.col('shares_count')), 'total_shares'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_articles']
      ],
      raw: true
    });
    
    return {
      averages: {
        views: parseFloat(stats.avg_views) || 0,
        likes: parseFloat(stats.avg_likes) || 0,
        shares: parseFloat(stats.avg_shares) || 0,
        comments: parseFloat(stats.avg_comments) || 0
      },
      totals: {
        views: parseInt(stats.total_views) || 0,
        likes: parseInt(stats.total_likes) || 0,
        shares: parseInt(stats.total_shares) || 0,
        articles: parseInt(stats.total_articles) || 0
      }
    };
  };

  return News;
};

// ================================
// models/User.js - Enhanced with avatar support
// ================================

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
        notEmpty: true
      }
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        len: [8, 255]
      }
    },
    first_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 50]
      }
    },
    last_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 50]
      }
    },
    role: {
      type: DataTypes.ENUM('super_admin', 'admin', 'editor', 'contributor'),
      defaultValue: 'contributor',
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active',
      allowNull: false
    },
    // Enhanced avatar fields
    avatar: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Avatar image ID'
    },
    avatar_data: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Avatar image data with all sizes'
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    website: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    social_links: {
      type: DataTypes.JSON,
      defaultValue: {},
      allowNull: true,
      comment: 'Social media links'
    },
    timezone: {
      type: DataTypes.STRING(50),
      defaultValue: 'UTC',
      allowNull: false
    },
    language: {
      type: DataTypes.STRING(5),
      defaultValue: 'en',
      allowNull: false
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_login_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    login_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    email_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    email_verification_token: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    password_reset_token: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    password_reset_expires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    two_factor_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    two_factor_secret: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    preferences: {
      type: DataTypes.JSON,
      defaultValue: {
        notifications: {
          email: true,
          push: false,
          article_published: true,
          article_commented: true
        },
        editor: {
          autosave: true,
          preview_mode: 'side',
          default_visibility: 'public'
        },
        dashboard: {
          articles_per_page: 10,
          default_article_status: 'draft'
        }
      }
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
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['email']
      },
      {
        fields: ['role']
      },
      {
        fields: ['status']
      },
      {
        fields: ['created_at']
      }
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      },
      
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          user.password = await bcrypt.hash(user.password, 12);
        }
        user.updated_at = new Date();
      }
    }
  });

  // Instance methods
  User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  User.prototype.getFullName = function() {
    return `${this.first_name} ${this.last_name}`;
  };

  User.prototype.isActive = function() {
    return this.status === 'active';
  };

  User.prototype.canEdit = function(resource) {
    const permissions = {
      super_admin: ['all'],
      admin: ['users', 'news', 'categories', 'tags', 'settings'],
      editor: ['news', 'categories', 'tags'],
      contributor: ['news']
    };
    
    return permissions[this.role].includes('all') || 
           permissions[this.role].includes(resource);
  };

  User.prototype.canDelete = function(resource) {
    const permissions = {
      super_admin: ['all'],
      admin: ['users', 'news', 'categories', 'tags'],
      editor: ['news', 'tags'],
      contributor: []
    };
    
    return permissions[this.role].includes('all') || 
           permissions[this.role].includes(resource);
  };

  User.prototype.canPublish = function() {
    return ['super_admin', 'admin', 'editor'].includes(this.role);
  };

  // Enhanced avatar methods
  User.prototype.getAvatarUrl = function(size = 'medium', baseUrl = null) {
    if (!this.avatar_data || !this.avatar_data.images) {
      return this.getGravatarUrl(size);
    }
    
    const image = this.avatar_data.images[size];
    if (!image) return this.getGravatarUrl(size);
    
    const domain = baseUrl || process.env.CDN_URL || process.env.BASE_URL || 'http://localhost:3000';
    return `${domain}${image.path}`;
  };

  User.prototype.getGravatarUrl = function(size = 'medium') {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(this.email.toLowerCase()).digest('hex');
    const sizeMap = {
      thumbnail: 150,
      small: 200,
      medium: 300,
      large: 400
    };
    const pixelSize = sizeMap[size] || 300;
    return `https://www.gravatar.com/avatar/${hash}?s=${pixelSize}&d=identicon`;
  };

  User.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    
    // Remove sensitive fields
    delete values.password;
    delete values.email_verification_token;
    delete values.password_reset_token;
    delete values.two_factor_secret;
    
    // Add avatar URL
    values.avatar_url = this.getAvatarUrl();
    
    return values;
  };

  // Class methods
  User.findByEmail = async function(email) {
    return await this.findOne({
      where: { email: email.toLowerCase() }
    });
  };

  User.findByRole = async function(role) {
    return await this.findAll({
      where: { role, status: 'active' }
    });
  };

  User.getActiveCount = async function() {
    return await this.count({
      where: { status: 'active' }
    });
  };

  User.getRoleHierarchy = function() {
    return {
      super_admin: 4,
      admin: 3,
      editor: 2,
      contributor: 1
    };
  };

  User.prototype.hasHigherRoleThan = function(otherUser) {
    const hierarchy = User.getRoleHierarchy();
    return hierarchy[this.role] > hierarchy[otherUser.role];
  };

  return User;
};