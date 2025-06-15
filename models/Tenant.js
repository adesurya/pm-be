// models/Tenant.js
const { DataTypes } = require('sequelize');
const { masterDB } = require('../config/database');

const Tenant = masterDB.define('Tenant', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  domain: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      isUrl: true
    }
  },
  subdomain: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true,
    validate: {
      is: /^[a-z0-9-]+$/i,
      len: [3, 50]
    }
  },
  database_name: {
    type: DataTypes.STRING(100),
    allowNull: true, // Allow null initially, will be set in beforeCreate hook
    unique: true
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'suspended', 'trial'),
    defaultValue: 'trial',
    allowNull: false
  },
  plan: {
    type: DataTypes.ENUM('trial', 'basic', 'professional', 'enterprise'),
    defaultValue: 'trial',
    allowNull: false
  },
  settings: {
    type: DataTypes.JSON,
    defaultValue: {
      theme: 'default',
      language: 'en',
      timezone: 'UTC',
      features: {
        analytics: false,
        seo: false,
        advanced_editor: false,
        api_access: false
      }
    }
  },
  limits: {
    type: DataTypes.JSON,
    defaultValue: {
      max_users: 9999999,
      max_articles: 9999999,
      max_categories: 9999999,
      max_tags: 9999999,
      storage_mb: 1000
    }
  },
  contact_email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  contact_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  trial_ends_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
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
  tableName: 'tenants',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['domain']
    },
    {
      unique: true,
      fields: ['subdomain']
    },
    {
      fields: ['status']
    },
    {
      fields: ['plan']
    }
  ],
  hooks: {
    beforeCreate: async (tenant) => {
      // Generate database name if not provided
      if (!tenant.database_name) {
        tenant.database_name = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
      }
      
      // Set trial end date
      if (tenant.plan === 'trial' && !tenant.trial_ends_at) {
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 30); // 30 days trial
        tenant.trial_ends_at = trialEnd;
      }
    },
    
    beforeUpdate: (tenant) => {
      tenant.updated_at = new Date();
      
      // Ensure database_name is set
      if (!tenant.database_name) {
        tenant.database_name = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
      }
    }
  }
});

// Instance methods
Tenant.prototype.isActive = function() {
  return this.status === 'active';
};

Tenant.prototype.isTrialExpired = function() {
  if (this.plan !== 'trial' || !this.trial_ends_at) {
    return false;
  }
  return new Date() > this.trial_ends_at;
};

Tenant.prototype.canCreateUser = function(currentUserCount) {
  return currentUserCount < this.limits.max_users;
};

Tenant.prototype.canCreateArticle = function(currentArticleCount) {
  return currentArticleCount < this.limits.max_articles;
};

Tenant.prototype.hasFeature = function(feature) {
  return this.settings.features && this.settings.features[feature] === true;
};

// Class methods
Tenant.findByDomain = async function(domain) {
  return await this.findOne({
    where: {
      domain: domain,
      status: 'active'
    }
  });
};

Tenant.findBySubdomain = async function(subdomain) {
  return await this.findOne({
    where: {
      subdomain: subdomain,
      status: 'active'
    }
  });
};

Tenant.getActiveCount = async function() {
  return await this.count({
    where: {
      status: 'active'
    }
  });
};

const updateTenantLimits = async () => {
  try {
    // Update default limits untuk semua tenant existing
    await Tenant.update(
      {
        limits: {
          max_users: 9999999,
          max_articles: 9999999,
          max_categories: 9999999,
          max_tags: 9999999,
          storage_mb: 9999999
        }
      },
      {
        where: {} // Update all tenants
      }
    );
    console.log('✅ Updated tenant limits to remove restrictions');
  } catch (error) {
    console.error('❌ Failed to update tenant limits:', error);
  }
};

module.exports = Tenant;