// config/cache.js - Simple mock cache service (no external dependencies)
class MockCacheService {
  constructor() {
    this.cache = new Map();
    this.enabled = false; // Disable caching for now
    console.log('📦 Mock cache service initialized (caching disabled)');
  }

  // Generate cache key with tenant isolation
  generateKey(tenantId, key) {
    return `tenant:${tenantId}:${key}`;
  }

  async get(tenantId, key) {
    if (!this.enabled) return null;
    
    const cacheKey = this.generateKey(tenantId, key);
    return this.cache.get(cacheKey) || null;
  }

  async set(tenantId, key, value, ttl = 600) {
    if (!this.enabled) return true;
    
    const cacheKey = this.generateKey(tenantId, key);
    this.cache.set(cacheKey, value);
    
    // Simple TTL cleanup (optional)
    if (ttl > 0) {
      setTimeout(() => {
        this.cache.delete(cacheKey);
      }, ttl * 1000);
    }
    
    return true;
  }

  async del(tenantId, key) {
    if (!this.enabled) return true;
    
    const cacheKey = this.generateKey(tenantId, key);
    this.cache.delete(cacheKey);
    return true;
  }

  async invalidatePattern(tenantId, pattern) {
    if (!this.enabled) return true;
    
    const fullPattern = this.generateKey(tenantId, pattern);
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(fullPattern.replace('*', ''))) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    return true;
  }

  // Cache news articles
  async cacheArticle(tenantId, articleId, article) {
    return await this.set(tenantId, `article:${articleId}`, article, 1800);
  }

  async getCachedArticle(tenantId, articleId) {
    return await this.get(tenantId, `article:${articleId}`);
  }

  // Cache article lists
  async cacheArticleList(tenantId, key, articles, ttl = 300) {
    return await this.set(tenantId, `articles:${key}`, articles, ttl);
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
    return true;
  }

  // Cache categories
  async cacheCategories(tenantId, categories, ttl = 900) {
    return await this.set(tenantId, 'categories:all', categories, ttl);
  }

  async getCachedCategories(tenantId) {
    return await this.get(tenantId, 'categories:all');
  }

  async invalidateCategoriesCache(tenantId) {
    return await this.invalidatePattern(tenantId, 'categories:*');
  }

  // Cache tags
  async cacheTags(tenantId, tags, ttl = 900) {
    return await this.set(tenantId, 'tags:all', tags, ttl);
  }

  async getCachedTags(tenantId) {
    return await this.get(tenantId, 'tags:all');
  }

  async invalidateTagsCache(tenantId) {
    return await this.invalidatePattern(tenantId, 'tags:*');
  }

  // Health check
  async healthCheck() {
    return { 
      status: 'healthy', 
      type: 'mock',
      enabled: this.enabled,
      keys: this.cache.size 
    };
  }

  // Get cache statistics
  async getStats() {
    return {
      type: 'mock',
      enabled: this.enabled,
      keys: this.cache.size,
      memory_usage: process.memoryUsage()
    };
  }

  // Enable/disable caching
  enable() {
    this.enabled = true;
    console.log('📦 Mock cache enabled');
  }

  disable() {
    this.enabled = false;
    this.cache.clear();
    console.log('📦 Mock cache disabled and cleared');
  }
}

module.exports = new MockCacheService();