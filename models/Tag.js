// models/Tag.js
const { DataTypes } = require('sequelize');
const slugify = require('slugify');

module.exports = (sequelize) => {
  const Tag = sequelize.define('Tag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [2, 50]
      }
    },
    slug: {
      type: DataTypes.STRING(70),
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
    usage_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
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
    tableName: 'tags',
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
        fields: ['is_active']
      },
      {
        fields: ['usage_count']
      },
      {
        fields: ['created_at']
      }
    ],
    hooks: {
      beforeCreate: async (tag) => {
        // Generate slug from name
        if (!tag.slug && tag.name) {
          tag.slug = await Tag.generateUniqueSlug(tag.name);
        }
        
        // Ensure name is lowercase
        tag.name = tag.name.toLowerCase().trim();
      },
      
      beforeUpdate: async (tag) => {
        // Update slug if name changed
        if (tag.changed('name') && tag.name) {
          tag.name = tag.name.toLowerCase().trim();
          tag.slug = await Tag.generateUniqueSlug(tag.name, tag.id);
        }
        
        tag.updated_at = new Date();
      }
    }
  });

  // Instance methods
  Tag.prototype.getUrl = function() {
    return `/tag/${this.slug}`;
  };

  Tag.prototype.incrementUsage = async function() {
    this.usage_count += 1;
    await this.save({ fields: ['usage_count'] });
  };

  Tag.prototype.decrementUsage = async function() {
    if (this.usage_count > 0) {
      this.usage_count -= 1;
      await this.save({ fields: ['usage_count'] });
    }
  };

  Tag.prototype.getRandomColor = function() {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
      '#8B5CF6', '#06B6D4', '#84CC16', '#F97316',
      '#EC4899', '#6B7280', '#14B8A6', '#F43F5E'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Class methods
  Tag.generateUniqueSlug = async function(name, excludeId = null) {
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

  Tag.findActive = async function(options = {}) {
    return await this.findAll({
      where: {
        is_active: true,
        ...options.where
      },
      order: [['name', 'ASC']],
      ...options
    });
  };

  Tag.findBySlug = async function(slug) {
    return await this.findOne({
      where: { 
        slug,
        is_active: true
      }
    });
  };

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
        continue; // Skip invalid tag names
      }
      
      let tag = await this.findByName(cleanName);
      
      if (!tag) {
        tag = await this.create({
          name: cleanName,
          color: this.prototype.getRandomColor()
        });
      }
      
      tags.push(tag);
    }
    
    return tags;
  };

  Tag.getPopular = async function(limit = 20) {
    return await this.findActive({
      where: {
        usage_count: {
          [sequelize.Sequelize.Op.gt]: 0
        }
      },
      order: [['usage_count', 'DESC']],
      limit
    });
  };

  Tag.getTrending = async function(limit = 10, days = 30) {
    // Get tags that have been used in articles published in the last X days
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    
    return await this.findAll({
      attributes: [
        'id',
        'name',
        'slug',
        'color',
        'usage_count',
        [sequelize.fn('COUNT', sequelize.col('articles.id')), 'recent_usage']
      ],
      include: [
        {
          association: 'articles',
          attributes: [],
          where: {
            status: 'published',
            published_at: {
              [sequelize.Sequelize.Op.gte]: dateLimit
            }
          }
        }
      ],
      where: { is_active: true },
      group: ['Tag.id'],
      order: [[sequelize.literal('recent_usage'), 'DESC']],
      limit,
      subQuery: false
    });
  };

  Tag.getCloud = async function(minCount = 1) {
    return await this.findActive({
      where: {
        usage_count: {
          [sequelize.Sequelize.Op.gte]: minCount
        }
      },
      order: [['usage_count', 'DESC']]
    });
  };

  Tag.search = async function(query, limit = 10) {
    return await this.findActive({
      where: {
        name: {
          [sequelize.Sequelize.Op.like]: `%${query}%`
        }
      },
      limit,
      order: [['usage_count', 'DESC'], ['name', 'ASC']]
    });
  };

  Tag.getUnused = async function() {
    return await this.findActive({
      where: {
        usage_count: 0
      },
      order: [['created_at', 'DESC']]
    });
  };

  Tag.bulkUpdateUsageCounts = async function() {
    // Recalculate usage counts for all tags
    const tags = await this.findAll();
    
    for (const tag of tags) {
      const count = await sequelize.models.NewsTag.count({
        where: { tag_id: tag.id }
      });
      
      await tag.update({ usage_count: count });
    }
    
    return true;
  };

  Tag.cleanup = async function(minUsage = 0, olderThanDays = 30) {
    // Remove unused tags older than specified days
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - olderThanDays);
    
    return await this.destroy({
      where: {
        usage_count: {
          [sequelize.Sequelize.Op.lte]: minUsage
        },
        created_at: {
          [sequelize.Sequelize.Op.lt]: dateLimit
        }
      }
    });
  };

  Tag.getStatistics = async function() {
    const stats = await this.findOne({
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_tags'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN usage_count > 0 THEN 1 END')), 'used_tags'],
        [sequelize.fn('AVG', sequelize.col('usage_count')), 'avg_usage'],
        [sequelize.fn('MAX', sequelize.col('usage_count')), 'max_usage']
      ],
      where: { is_active: true },
      raw: true
    });
    
    return {
      total: parseInt(stats.total_tags) || 0,
      used: parseInt(stats.used_tags) || 0,
      unused: (parseInt(stats.total_tags) || 0) - (parseInt(stats.used_tags) || 0),
      averageUsage: parseFloat(stats.avg_usage) || 0,
      maxUsage: parseInt(stats.max_usage) || 0
    };
  };

  return Tag;
};