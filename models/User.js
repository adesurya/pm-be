// models/User.js
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
    avatar: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
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
          push: false
        },
        editor: {
          autosave: true,
          preview_mode: 'side'
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

  User.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    
    // Remove sensitive fields
    delete values.password;
    delete values.email_verification_token;
    delete values.password_reset_token;
    delete values.two_factor_secret;
    
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