// models/NewsTag.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const NewsTag = sequelize.define('NewsTag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    news_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'news',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    tag_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'tags',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    }
  }, {
    tableName: 'news_tags',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
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
    ],
    hooks: {
      afterCreate: async (newsTag) => {
        // Increment tag usage count
        const Tag = sequelize.models.Tag;
        if (Tag) {
          await sequelize.query(
            'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?',
            {
              replacements: [newsTag.tag_id],
              type: sequelize.QueryTypes.UPDATE
            }
          );
        }
      },
      
      afterDestroy: async (newsTag) => {
        // Decrement tag usage count
        const Tag = sequelize.models.Tag;
        if (Tag) {
          await sequelize.query(
            'UPDATE tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = ?',
            {
              replacements: [newsTag.tag_id],
              type: sequelize.QueryTypes.UPDATE
            }
          );
        }
      }
    }
  });

  return NewsTag;
};