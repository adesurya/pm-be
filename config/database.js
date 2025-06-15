// config/database.js
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
    // Import models
    const User = require('../models/User')(tenantDB);
    const Category = require('../models/Category')(tenantDB);
    const Tag = require('../models/Tag')(tenantDB);
    const News = require('../models/News')(tenantDB);
    const NewsTag = require('../models/NewsTag')(tenantDB);

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