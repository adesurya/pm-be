// config/masterModels.js - Master database models (FIXED VERSION)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const initializeMasterModels = async (sequelize) => {
  const { DataTypes } = require('sequelize');

  // Master Admin model
  const MasterAdmin = sequelize.define('MasterAdmin', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('super_admin', 'system_admin'),
      defaultValue: 'super_admin',
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active',
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
      defaultValue: 0
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'master_admins',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      beforeCreate: async (admin) => {
        if (admin.password) {
          admin.password = await bcrypt.hash(admin.password, 12);
        }
      },
      beforeUpdate: async (admin) => {
        if (admin.changed('password')) {
          admin.password = await bcrypt.hash(admin.password, 12);
        }
        admin.updated_at = new Date();
      }
    }
  });

  // Tenant model
  const Tenant = sequelize.define('Tenant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    domain: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    subdomain: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true
    },
    database_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended', 'provisioning'),
      defaultValue: 'provisioning',
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
        storage_mb: 9999999
      }
    },
    contact_email: {
      type: DataTypes.STRING(255),
      allowNull: false
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
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'tenants',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      beforeCreate: async (tenant) => {
        if (!tenant.database_name) {
          tenant.database_name = `news_cms_tenant_${tenant.id.replace(/-/g, '_')}`;
        }
        
        if (tenant.plan === 'trial' && !tenant.trial_ends_at) {
          const trialEnd = new Date();
          trialEnd.setDate(trialEnd.getDate() + 30);
          tenant.trial_ends_at = trialEnd;
        }
      },
      beforeUpdate: (tenant) => {
        tenant.updated_at = new Date();
      }
    }
  });

  // Add instance methods to MasterAdmin
  MasterAdmin.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };
  
  MasterAdmin.prototype.generateToken = function() {
    return jwt.sign(
      {
        id: this.id,
        email: this.email,
        name: this.name,
        role: this.role,
        type: 'master_admin'
      },
      process.env.JWT_SECRET || 'bulletproof-secret-key-2024',
      { expiresIn: '24h' }
    );
  };
  
  MasterAdmin.prototype.toSafeJSON = function() {
    const admin = this.toJSON();
    delete admin.password;
    return admin;
  };

  // Add instance methods to Tenant
  Tenant.prototype.isActive = function() {
    return this.status === 'active';
  };

  Tenant.prototype.isTrialExpired = function() {
    if (this.plan !== 'trial' || !this.trial_ends_at) {
      return false;
    }
    return new Date() > this.trial_ends_at;
  };
  
  Tenant.prototype.canCreateUser = function(currentCount) {
    return currentCount < this.limits.max_users;
  };
  
  Tenant.prototype.canCreateArticle = function(currentCount) {
    return currentCount < this.limits.max_articles;
  };

  // Sync models
  await MasterAdmin.sync();
  await Tenant.sync();
  
  console.log('✅ Master models synchronized');
  
  return { MasterAdmin, Tenant };
};

module.exports = { initializeMasterModels };