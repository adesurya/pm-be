// config/database.js - Updated for complete server
const { Sequelize } = require('sequelize');
require('dotenv').config();

// Master database connection for tenant management
const masterDB = new Sequelize(
  process.env.MASTER_DB_NAME || 'news_cms_master',
  process.env.MASTER_DB_USER || 'root',
  process.env.MASTER_DB_PASS || '',
  {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: process.env.MASTER_DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
);

// Tenant database connections cache
const tenantConnections = new Map();

/**
 * Get or create tenant database connection
 * @param {string} tenantId - Tenant identifier
 * @returns {Sequelize} Sequelize instance for tenant
 */
const getTenantDB = async (tenantId) => {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  // Check if connection already exists
  if (tenantConnections.has(tenantId)) {
    return tenantConnections.get(tenantId);
  }

  // Create new tenant database connection
  const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
  
  const tenantDB = new Sequelize(
    dbName,
    process.env.TENANT_DB_USER || process.env.MASTER_DB_USER || 'root',
    process.env.TENANT_DB_PASS || process.env.MASTER_DB_PASS || '',
    {
      host: process.env.TENANT_DB_HOST || process.env.MASTER_DB_HOST || 'localhost',
      port: process.env.TENANT_DB_PORT || process.env.MASTER_DB_PORT || 3306,
      dialect: 'mysql',
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      },
      define: {
        timestamps: true,
        underscored: true,
        freezeTableName: true
      }
    }
  );

  // Test connection
  try {
    await tenantDB.authenticate();
    console.log(`✅ Tenant DB connection established for: ${tenantId}`);
    
    // Cache the connection
    tenantConnections.set(tenantId, tenantDB);
    
    return tenantDB;
  } catch (error) {
    console.error(`❌ Unable to connect to tenant database ${tenantId}:`, error);
    throw error;
  }
};

/**
 * Create tenant database
 * @param {string} tenantId - Tenant identifier
 */
const createTenantDB = async (tenantId) => {
  const dbName = `news_cms_tenant_${tenantId.replace(/-/g, '_')}`;
  
  // Create database
  const tempConnection = new Sequelize(
    '',
    process.env.TENANT_DB_USER || process.env.MASTER_DB_USER || 'root',
    process.env.TENANT_DB_PASS || process.env.MASTER_DB_PASS || '',
    {
      host: process.env.TENANT_DB_HOST || process.env.MASTER_DB_HOST || 'localhost',
      port: process.env.TENANT_DB_PORT || process.env.MASTER_DB_PORT || 3306,
      dialect: 'mysql',
      logging: false
    }
  );

  try {
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Tenant database created: ${dbName}`);
    await tempConnection.close();
  } catch (error) {
    console.error(`❌ Error creating tenant database ${dbName}:`, error);
    await tempConnection.close();
    throw error;
  }
};

/**
 * Initialize tenant models
 * @param {Sequelize} tenantDB - Tenant database instance
 */
const initializeTenantModels = async (tenantDB) => {
  try {
    const bcrypt = require('bcryptjs');
    
    // User model
    const User = tenantDB.define('User', {
      id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        defaultValue: tenantDB.Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      email: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
          notEmpty: true
        }
      },
      password: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: false,
        validate: {
          len: [8, 255]
        }
      },
      first_name: {
        type: tenantDB.Sequelize.DataTypes.STRING(50),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 50]
        }
      },
      last_name: {
        type: tenantDB.Sequelize.DataTypes.STRING(50),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 50]
        }
      },
      role: {
        type: tenantDB.Sequelize.DataTypes.ENUM('super_admin', 'admin', 'editor', 'contributor'),
        defaultValue: 'contributor',
        allowNull: false
      },
      status: {
        type: tenantDB.Sequelize.DataTypes.ENUM('active', 'inactive', 'suspended'),
        defaultValue: 'active',
        allowNull: false
      },
      avatar: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      bio: {
        type: tenantDB.Sequelize.DataTypes.TEXT,
        allowNull: true
      },
      phone: {
        type: tenantDB.Sequelize.DataTypes.STRING(20),
        allowNull: true
      },
      timezone: {
        type: tenantDB.Sequelize.DataTypes.STRING(50),
        defaultValue: 'UTC',
        allowNull: false
      },
      language: {
        type: tenantDB.Sequelize.DataTypes.STRING(5),
        defaultValue: 'en',
        allowNull: false
      },
      last_login: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        allowNull: true
      },
      last_login_ip: {
        type: tenantDB.Sequelize.DataTypes.STRING(45),
        allowNull: true
      },
      login_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      email_verified: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      email_verification_token: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      password_reset_token: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      password_reset_expires: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        allowNull: true
      },
      preferences: {
        type: tenantDB.Sequelize.DataTypes.JSON,
        defaultValue: {
          notifications: {
            email: true,
            push: false
          },
          editor: {
            autosave: true,
            preview_mode: 'side'
          }
        }
      },
      created_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
        allowNull: false
      },
      updated_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
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

    // Category model
    const Category = tenantDB.define('Category', {
      id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        defaultValue: tenantDB.Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: tenantDB.Sequelize.DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
          len: [2, 100]
        }
      },
      slug: {
        type: tenantDB.Sequelize.DataTypes.STRING(120),
        allowNull: false,
        unique: true
      },
      description: {
        type: tenantDB.Sequelize.DataTypes.TEXT,
        allowNull: true
      },
      color: {
        type: tenantDB.Sequelize.DataTypes.STRING(7),
        allowNull: true,
        defaultValue: '#3B82F6',
        validate: {
          is: /^#[0-9A-F]{6}$/i
        }
      },
      is_featured: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_active: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      posts_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      created_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
        allowNull: false
      }
    }, {
      tableName: 'categories',
      timestamps: false,
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
          fields: ['is_featured']
        }
      ],
      hooks: {
        beforeCreate: async (category) => {
          if (!category.slug && category.name) {
            const slugify = require('slugify');
            category.slug = slugify(category.name, {
              lower: true,
              strict: true,
              remove: /[*+~.()'"!:@]/g
            });
          }
        }
      }
    });

    // Tag model
    const Tag = tenantDB.define('Tag', {
      id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        defaultValue: tenantDB.Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: tenantDB.Sequelize.DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
          len: [2, 50]
        }
      },
      slug: {
        type: tenantDB.Sequelize.DataTypes.STRING(70),
        allowNull: false,
        unique: true
      },
      color: {
        type: tenantDB.Sequelize.DataTypes.STRING(7),
        allowNull: true,
        defaultValue: '#3B82F6',
        validate: {
          is: /^#[0-9A-F]{6}$/i
        }
      },
      usage_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      is_active: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      created_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
        allowNull: false
      }
    }, {
      tableName: 'tags',
      timestamps: false,
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
          fields: ['usage_count']
        }
      ],
      hooks: {
        beforeCreate: async (tag) => {
          if (!tag.slug && tag.name) {
            const slugify = require('slugify');
            tag.slug = slugify(tag.name, {
              lower: true,
              strict: true,
              remove: /[*+~.()'"!:@]/g
            });
          }
          tag.name = tag.name.toLowerCase().trim();
        }
      }
    });

    // News model
    const News = tenantDB.define('News', {
      id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        defaultValue: tenantDB.Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      title: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [5, 255]
        }
      },
      slug: {
        type: tenantDB.Sequelize.DataTypes.STRING(300),
        allowNull: false,
        unique: true
      },
      excerpt: {
        type: tenantDB.Sequelize.DataTypes.TEXT,
        allowNull: true,
        validate: {
          len: [0, 500]
        }
      },
      content: {
        type: tenantDB.Sequelize.DataTypes.TEXT('long'),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [10, 65535]
        }
      },
      featured_image: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      featured_image_alt: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      status: {
        type: tenantDB.Sequelize.DataTypes.ENUM('draft', 'review', 'published', 'archived'),
        defaultValue: 'draft',
        allowNull: false
      },
      visibility: {
        type: tenantDB.Sequelize.DataTypes.ENUM('public', 'private', 'password'),
        defaultValue: 'public',
        allowNull: false
      },
      author_id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        }
      },
      category_id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'categories',
          key: 'id'
        }
      },
      published_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        allowNull: true
      },
      views_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      likes_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      comments_count: {
        type: tenantDB.Sequelize.DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      is_featured: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      is_breaking: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      allow_comments: {
        type: tenantDB.Sequelize.DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      meta_title: {
        type: tenantDB.Sequelize.DataTypes.STRING(255),
        allowNull: true
      },
      meta_description: {
        type: tenantDB.Sequelize.DataTypes.STRING(500),
        allowNull: true
      },
      created_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
        allowNull: false
      },
      updated_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
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
          fields: ['views_count']
        }
      ],
      hooks: {
        beforeCreate: async (news) => {
          if (!news.slug && news.title) {
            const slugify = require('slugify');
            news.slug = slugify(news.title, {
              lower: true,
              strict: true,
              remove: /[*+~.()'"!:@]/g
            });
          }
          
          if (news.status === 'published' && !news.published_at) {
            news.published_at = new Date();
          }
        },
        
        beforeUpdate: async (news) => {
          if (news.changed('title') && news.title) {
            const slugify = require('slugify');
            news.slug = slugify(news.title, {
              lower: true,
              strict: true,
              remove: /[*+~.()'"!:@]/g
            });
          }
          
          if (news.changed('status') && news.status === 'published' && !news.published_at) {
            news.published_at = new Date();
          }
          
          if (news.changed('status') && news.status !== 'published' && news.published_at) {
            news.published_at = null;
          }
          
          news.updated_at = new Date();
        }
      }
    });

    // NewsTag junction model
    const NewsTag = tenantDB.define('NewsTag', {
      id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        defaultValue: tenantDB.Sequelize.DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      news_id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'news',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      tag_id: {
        type: tenantDB.Sequelize.DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'tags',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      created_at: {
        type: tenantDB.Sequelize.DataTypes.DATE,
        defaultValue: tenantDB.Sequelize.DataTypes.NOW,
        allowNull: false
      }
    }, {
      tableName: 'news_tags',
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ['news_id', 'tag_id']
        },
        {
          fields: ['news_id']
        },
        {
          fields: ['tag_id']
        }
      ]
    });

    // Add instance methods to User
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

    User.prototype.toJSON = function() {
      const values = Object.assign({}, this.get());
      
      // Remove sensitive fields
      delete values.password;
      delete values.email_verification_token;
      delete values.password_reset_token;
      
      return values;
    };

    // Add class methods to User
    User.findByEmail = async function(email) {
      return await this.findOne({
        where: { email: email.toLowerCase() }
      });
    };

    User.getActiveCount = async function() {
      return await this.count({
        where: { status: 'active' }
      });
    };

    // Add instance methods to News
    News.prototype.isPublished = function() {
      return this.status === 'published' && this.published_at && this.published_at <= new Date();
    };

    News.prototype.canBeViewedByPublic = function() {
      return this.isPublished() && this.visibility === 'public';
    };

    News.prototype.getUrl = function() {
      return `/news/${this.slug}`;
    };

    // Add class methods to Tag
    Tag.findByName = async function(name) {
      return await this.findOne({
        where: { 
          name: name.toLowerCase().trim(),
          is_active: true
        }
      });
    };

    Tag.findOrCreate = async function(tagNames) {
      const tags = [];
      
      for (const tagName of tagNames) {
        const cleanName = tagName.toLowerCase().trim();
        
        if (cleanName.length < 2 || cleanName.length > 50) {
          continue;
        }
        
        let tag = await this.findByName(cleanName);
        
        if (!tag) {
          const slugify = require('slugify');
          tag = await this.create({
            name: cleanName,
            slug: slugify(cleanName, {
              lower: true,
              strict: true,
              remove: /[*+~.()'"!:@]/g
            }),
            color: '#3B82F6'
          });
        }
        
        tags.push(tag);
      }
      
      return tags;
    };

    // Define associations
    User.hasMany(News, { foreignKey: 'author_id', as: 'articles' });
    News.belongsTo(User, { foreignKey: 'author_id', as: 'author' });

    Category.hasMany(News, { foreignKey: 'category_id', as: 'articles' });
    News.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

    News.belongsToMany(Tag, { 
      through: NewsTag, 
      foreignKey: 'news_id', 
      otherKey: 'tag_id',
      as: 'tags'
    });
    
    Tag.belongsToMany(News, { 
      through: NewsTag, 
      foreignKey: 'tag_id', 
      otherKey: 'news_id',
      as: 'articles'
    });

    // Sync models to create tables
    await tenantDB.sync({ alter: true });
    
    console.log(`✅ Tenant models initialized and synced`);
    
    return {
      User,
      Category,
      Tag,
      News,
      NewsTag
    };
  } catch (error) {
    console.error('❌ Error initializing tenant models:', error);
    throw error;
  }
};

/**
 * Close tenant database connection
 * @param {string} tenantId - Tenant identifier
 */
const closeTenantDB = async (tenantId) => {
  if (tenantConnections.has(tenantId)) {
    const connection = tenantConnections.get(tenantId);
    await connection.close();
    tenantConnections.delete(tenantId);
    console.log(`🔒 Tenant DB connection closed for: ${tenantId}`);
  }
};

module.exports = {
  masterDB,
  getTenantDB,
  createTenantDB,
  initializeTenantModels,
  closeTenantDB,
  tenantConnections
};