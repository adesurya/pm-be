// config/redis.js
const redis = require('redis');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.redisClient = null;
    this.nodeCache = new NodeCache({ 
      stdTTL: 600, // 10 minutes default
      checkperiod: 120 // Check for expired keys every 2 minutes
    });
    this.useRedis = process.env.REDIS_URL || process.env.REDIS_HOST;
    
    if (this.useRedis) {
      this.initializeRedis();
    } else {
      logger.warn('Redis not configured, using in-memory cache');
    }
  }

  async initializeRedis() {
    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB || 0,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      };

      if (process.env.REDIS_URL) {
        this.redisClient = redis.createClient({ 
          url: process.env.REDIS_URL,
          socket: {
            reconnectStrategy: (retries) => Math.min(retries * 50, 500)
          }
        });
      } else {
        this.redisClient = redis.createClient(redisConfig);
      }

      this.redisClient.on('error', (err) => {
        logger.error('Redis Client Error:', err);
      });

      this.redisClient.on('connect', () => {
        logger.info('✅ Redis connected successfully');
      });

      this.redisClient.on('ready', () => {
        logger.info('✅ Redis ready for use');
      });

      this.redisClient.on('end', () => {
        logger.warn('Redis connection ended');
      });

      await this.redisClient.connect();
    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
      this.redisClient = null;
    }
  }

  // Generate cache key with tenant isolation
  generateKey(tenantId, key) {
    return `tenant:${tenantId}:${key}`;
  }

  async get(tenantId, key) {
    const cacheKey = this.generateKey(tenantId, key);
    
    try {
      if (this.redisClient?.isReady) {
        const result = await this.redisClient.get(cacheKey);
        return result ? JSON.parse(result) : null;
      } else {
        return this.nodeCache.get(cacheKey);
      }
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  async set(tenantId, key, value, ttl = 600) {
    const cacheKey = this.generateKey(tenantId, key);
    
    try {
      if (this.redisClient?.isReady) {
        await this.redisClient.setEx(cacheKey, ttl, JSON.stringify(value));
      } else {
        this.nodeCache.set(cacheKey, value, ttl);
      }
      return true;
    } catch (error) {
      logger.error('Cache set error:', error);
      return false;
    }
  }

  async del(tenantId, key) {
    const cacheKey = this.generateKey(tenantId, key);
    
    try {
      if (this.redisClient?.isReady) {
        await this.redisClient.del(cacheKey);
      } else {
        this.nodeCache.del(cacheKey);
      }
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error);
      return false;
    }
  }

  async invalidatePattern(tenantId, pattern) {
    const fullPattern = this.generateKey(tenantId, pattern);
    
    try {
      if (this.redisClient?.isReady) {
        const stream = this.redisClient.scanIterator({
          MATCH: fullPattern,
          COUNT: 100
        });
        
        const keys = [];
        for await (const key of stream) {
          keys.push(key);
        }
        
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      } else {
        // For node-cache, we need to get all keys and filter
        const allKeys = this.nodeCache.keys();
        const keysToDelete = allKeys.filter(key => key.includes(fullPattern.replace('*', '')));
        keysToDelete.forEach(key => this.nodeCache.del(key));
      }
      return true;
    } catch (error) {
      logger.error('Cache invalidate pattern error:', error);
      return false;
    }
  }

  // Cache news articles
  async cacheArticle(tenantId, articleId, article) {
    await this.set(tenantId, `article:${articleId}`, article, 1800); // 30 minutes
  }

  async getCachedArticle(tenantId, articleId) {
    return await this.get(tenantId, `article:${articleId}`);
  }

  // Cache article lists
  async cacheArticleList(tenantId, key, articles, ttl = 300) {
    await this.set(tenantId, `articles:${key}`, articles, ttl);
  }

  async getCachedArticleList(tenantId, key) {
    return await this.get(tenantId, `articles:${key}`);
  }

  // Invalidate article caches
  async invalidateArticleCache(tenantId, articleId = null) {
    if (articleId) {
      await this.del(tenantId, `article:${articleId}`);
    }
    await this.invalidatePattern(tenantId, 'articles:*');
  }

  // Cache categories
  async cacheCategories(tenantId, categories, ttl = 900) {
    await this.set(tenantId, 'categories:all', categories, ttl);
  }

  async getCachedCategories(tenantId) {
    return await this.get(tenantId, 'categories:all');
  }

  async invalidateCategoriesCache(tenantId) {
    await this.invalidatePattern(tenantId, 'categories:*');
  }

  // Cache tags
  async cacheTags(tenantId, tags, ttl = 900) {
    await this.set(tenantId, 'tags:all', tags, ttl);
  }

  async getCachedTags(tenantId) {
    return await this.get(tenantId, 'tags:all');
  }

  async invalidateTagsCache(tenantId) {
    await this.invalidatePattern(tenantId, 'tags:*');
  }

  // Health check
  async healthCheck() {
    try {
      if (this.redisClient?.isReady) {
        await this.redisClient.ping();
        return { status: 'healthy', type: 'redis' };
      } else {
        return { status: 'healthy', type: 'memory', keys: this.nodeCache.keys().length };
      }
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  // Get cache statistics
  async getStats() {
    try {
      if (this.redisClient?.isReady) {
        const info = await this.redisClient.info('memory');
        return {
          type: 'redis',
          info: info
        };
      } else {
        return {
          type: 'memory',
          keys: this.nodeCache.keys().length,
          stats: this.nodeCache.getStats()
        };
      }
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = new CacheService();