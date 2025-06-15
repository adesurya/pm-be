// services/cloudflareService.js
const axios = require('axios');
const logger = require('../utils/logger');

class CloudflareService {
  constructor() {
    this.apiUrl = 'https://api.cloudflare.com/client/v4';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.zoneId = process.env.CLOUDFLARE_ZONE_ID;
    this.defaultTTL = 300; // 5 minutes
    
    if (!this.apiToken) {
      logger.warn('Cloudflare API token not configured');
    }
  }

  /**
   * Get API headers for Cloudflare requests
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Verify API token and get user info
   */
  async verifyToken() {
    try {
      const response = await axios.get(`${this.apiUrl}/user/tokens/verify`, {
        headers: this.getHeaders(),
        timeout: 10000
      });

      if (response.data.success) {
        logger.info('Cloudflare API token verified successfully');
        return response.data.result;
      } else {
        throw new Error('Token verification failed');
      }
    } catch (error) {
      logger.error('Cloudflare token verification failed:', error);
      throw error;
    }
  }

  /**
   * Get zone information
   */
  async getZoneInfo() {
    try {
      const response = await axios.get(`${this.apiUrl}/zones/${this.zoneId}`, {
        headers: this.getHeaders()
      });

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`Zone info failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to get zone info:', error);
      throw error;
    }
  }

  /**
   * List all DNS records for a domain
   */
  async listDNSRecords(name = null, type = null) {
    try {
      let url = `${this.apiUrl}/zones/${this.zoneId}/dns_records`;
      const params = new URLSearchParams();
      
      if (name) params.append('name', name);
      if (type) params.append('type', type);
      
      if (params.toString()) {
        url += '?' + params.toString();
      }

      const response = await axios.get(url, {
        headers: this.getHeaders()
      });

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`List DNS records failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to list DNS records:', error);
      throw error;
    }
  }

  /**
   * Create DNS A record for domain
   */
  async createARecord(domain, ipAddress, proxied = true) {
    try {
      logger.info(`Creating A record for ${domain} -> ${ipAddress}`);

      // Check if record already exists
      const existingRecords = await this.listDNSRecords(domain, 'A');
      if (existingRecords.length > 0) {
        logger.info(`A record already exists for ${domain}`);
        return existingRecords[0];
      }

      const recordData = {
        type: 'A',
        name: domain,
        content: ipAddress,
        ttl: this.defaultTTL,
        proxied: proxied
      };

      const response = await axios.post(
        `${this.apiUrl}/zones/${this.zoneId}/dns_records`,
        recordData,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ A record created for ${domain}`);
        return response.data.result;
      } else {
        throw new Error(`Create A record failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to create A record for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Create DNS CNAME record
   */
  async createCNAMERecord(name, target, proxied = true) {
    try {
      logger.info(`Creating CNAME record for ${name} -> ${target}`);

      // Check if record already exists
      const existingRecords = await this.listDNSRecords(name, 'CNAME');
      if (existingRecords.length > 0) {
        logger.info(`CNAME record already exists for ${name}`);
        return existingRecords[0];
      }

      const recordData = {
        type: 'CNAME',
        name: name,
        content: target,
        ttl: this.defaultTTL,
        proxied: proxied
      };

      const response = await axios.post(
        `${this.apiUrl}/zones/${this.zoneId}/dns_records`,
        recordData,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ CNAME record created for ${name}`);
        return response.data.result;
      } else {
        throw new Error(`Create CNAME record failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to create CNAME record for ${name}:`, error);
      throw error;
    }
  }

  /**
   * Update existing DNS record
   */
  async updateDNSRecord(recordId, recordData) {
    try {
      const response = await axios.put(
        `${this.apiUrl}/zones/${this.zoneId}/dns_records/${recordId}`,
        recordData,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ DNS record ${recordId} updated`);
        return response.data.result;
      } else {
        throw new Error(`Update DNS record failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to update DNS record ${recordId}:`, error);
      throw error;
    }
  }

  /**
   * Delete DNS record
   */
  async deleteDNSRecord(recordId) {
    try {
      const response = await axios.delete(
        `${this.apiUrl}/zones/${this.zoneId}/dns_records/${recordId}`,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ DNS record ${recordId} deleted`);
        return true;
      } else {
        throw new Error(`Delete DNS record failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to delete DNS record ${recordId}:`, error);
      throw error;
    }
  }

  /**
   * Delete all DNS records for a domain
   */
  async deleteDomainRecords(domain) {
    try {
      logger.info(`Deleting all DNS records for ${domain}`);

      const records = await this.listDNSRecords(domain);
      
      for (const record of records) {
        await this.deleteDNSRecord(record.id);
      }

      logger.info(`✅ All DNS records deleted for ${domain}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete DNS records for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Setup complete DNS configuration for tenant
   */
  async setupTenantDNS(domain, ipAddress) {
    try {
      logger.info(`Setting up complete DNS configuration for ${domain}`);

      const results = [];

      // Create main A record
      const aRecord = await this.createARecord(domain, ipAddress, true);
      results.push({ type: 'A', name: domain, record: aRecord });

      // Create www CNAME record
      const wwwRecord = await this.createCNAMERecord(`www.${domain}`, domain, true);
      results.push({ type: 'CNAME', name: `www.${domain}`, record: wwwRecord });

      logger.info(`✅ Complete DNS setup finished for ${domain}`);
      return results;
    } catch (error) {
      logger.error(`Failed to setup DNS for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Get SSL/TLS settings for domain
   */
  async getSSLSettings() {
    try {
      const response = await axios.get(
        `${this.apiUrl}/zones/${this.zoneId}/settings/ssl`,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`Get SSL settings failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to get SSL settings:', error);
      throw error;
    }
  }

  /**
   * Update SSL/TLS settings
   */
  async updateSSLSettings(mode = 'full') {
    try {
      const response = await axios.patch(
        `${this.apiUrl}/zones/${this.zoneId}/settings/ssl`,
        { value: mode },
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ SSL mode updated to: ${mode}`);
        return response.data.result;
      } else {
        throw new Error(`Update SSL settings failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to update SSL settings:', error);
      throw error;
    }
  }

  /**
   * Enable Always Use HTTPS
   */
  async enableAlwaysHTTPS() {
    try {
      const response = await axios.patch(
        `${this.apiUrl}/zones/${this.zoneId}/settings/always_use_https`,
        { value: 'on' },
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info('✅ Always Use HTTPS enabled');
        return response.data.result;
      } else {
        throw new Error(`Enable Always HTTPS failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to enable Always Use HTTPS:', error);
      throw error;
    }
  }

  /**
   * Create page rule for caching
   */
  async createPageRule(url, settings) {
    try {
      const ruleData = {
        targets: [
          {
            target: 'url',
            constraint: {
              operator: 'matches',
              value: url
            }
          }
        ],
        actions: settings,
        priority: 1,
        status: 'active'
      };

      const response = await axios.post(
        `${this.apiUrl}/zones/${this.zoneId}/pagerules`,
        ruleData,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ Page rule created for ${url}`);
        return response.data.result;
      } else {
        throw new Error(`Create page rule failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to create page rule for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Setup optimal page rules for tenant
   */
  async setupTenantPageRules(domain) {
    try {
      logger.info(`Setting up page rules for ${domain}`);

      const rules = [];

      // API endpoints - bypass cache
      const apiRule = await this.createPageRule(`${domain}/api/*`, [
        { id: 'cache_level', value: 'bypass' }
      ]);
      rules.push(apiRule);

      // Static assets - cache everything
      const staticRule = await this.createPageRule(`${domain}/uploads/*`, [
        { id: 'cache_level', value: 'cache_everything' },
        { id: 'edge_cache_ttl', value: 2592000 } // 30 days
      ]);
      rules.push(staticRule);

      // Main pages - standard caching
      const mainRule = await this.createPageRule(`${domain}/*`, [
        { id: 'cache_level', value: 'standard' },
        { id: 'browser_cache_ttl', value: 14400 } // 4 hours
      ]);
      rules.push(mainRule);

      logger.info(`✅ Page rules setup completed for ${domain}`);
      return rules;
    } catch (error) {
      logger.error(`Failed to setup page rules for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Get zone analytics
   */
  async getZoneAnalytics(since = null) {
    try {
      let url = `${this.apiUrl}/zones/${this.zoneId}/analytics/dashboard`;
      
      if (since) {
        url += `?since=${since}`;
      }

      const response = await axios.get(url, {
        headers: this.getHeaders()
      });

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`Get analytics failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to get zone analytics:', error);
      throw error;
    }
  }

  /**
   * Purge cache for specific URLs
   */
  async purgeCache(urls = null) {
    try {
      const purgeData = urls ? { files: urls } : { purge_everything: true };

      const response = await axios.post(
        `${this.apiUrl}/zones/${this.zoneId}/purge_cache`,
        purgeData,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info('✅ Cache purged successfully');
        return response.data.result;
      } else {
        throw new Error(`Purge cache failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to purge cache:', error);
      throw error;
    }
  }

  /**
   * Setup complete Cloudflare configuration for new tenant
   */
  async setupTenantCloudflare(domain, ipAddress) {
    try {
      logger.info(`Setting up complete Cloudflare configuration for ${domain}`);

      const results = {
        dns_records: [],
        ssl_settings: null,
        page_rules: [],
        security_settings: []
      };

      // 1. Setup DNS records
      results.dns_records = await this.setupTenantDNS(domain, ipAddress);

      // 2. Configure SSL settings
      await this.updateSSLSettings('full');
      await this.enableAlwaysHTTPS();
      results.ssl_settings = await this.getSSLSettings();

      // 3. Setup page rules for optimal caching
      results.page_rules = await this.setupTenantPageRules(domain);

      // 4. Enable security features
      await this.enableSecurityFeatures();

      logger.info(`✅ Complete Cloudflare setup finished for ${domain}`);
      return results;
    } catch (error) {
      logger.error(`Failed to setup Cloudflare for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Enable security features
   */
  async enableSecurityFeatures() {
    try {
      // Enable Bot Fight Mode
      await axios.patch(
        `${this.apiUrl}/zones/${this.zoneId}/settings/bot_fight_mode`,
        { value: 'on' },
        { headers: this.getHeaders() }
      );

      // Set security level to medium
      await axios.patch(
        `${this.apiUrl}/zones/${this.zoneId}/settings/security_level`,
        { value: 'medium' },
        { headers: this.getHeaders() }
      );

      logger.info('✅ Security features enabled');
      return true;
    } catch (error) {
      logger.error('Failed to enable security features:', error);
      throw error;
    }
  }

  /**
   * Remove all Cloudflare configuration for tenant
   */
  async removeTenantCloudflare(domain) {
    try {
      logger.info(`Removing Cloudflare configuration for ${domain}`);

      // Delete DNS records
      await this.deleteDomainRecords(domain);
      await this.deleteDomainRecords(`www.${domain}`);

      // Delete page rules
      const pageRules = await this.getPageRules();
      for (const rule of pageRules) {
        if (rule.targets[0].constraint.value.includes(domain)) {
          await this.deletePageRule(rule.id);
        }
      }

      logger.info(`✅ Cloudflare configuration removed for ${domain}`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove Cloudflare config for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Get all page rules
   */
  async getPageRules() {
    try {
      const response = await axios.get(
        `${this.apiUrl}/zones/${this.zoneId}/pagerules`,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`Get page rules failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error('Failed to get page rules:', error);
      throw error;
    }
  }

  /**
   * Delete page rule
   */
  async deletePageRule(ruleId) {
    try {
      const response = await axios.delete(
        `${this.apiUrl}/zones/${this.zoneId}/pagerules/${ruleId}`,
        { headers: this.getHeaders() }
      );

      if (response.data.success) {
        logger.info(`✅ Page rule ${ruleId} deleted`);
        return true;
      } else {
        throw new Error(`Delete page rule failed: ${JSON.stringify(response.data.errors)}`);
      }
    } catch (error) {
      logger.error(`Failed to delete page rule ${ruleId}:`, error);
      throw error;
    }
  }

  /**
   * Check domain verification status
   */
  async checkDomainStatus(domain) {
    try {
      const records = await this.listDNSRecords(domain);
      const dnsStatus = records.length > 0;

      // Check if domain is reachable
      let reachable = false;
      try {
        const axios = require('axios');
        await axios.get(`https://${domain}/health`, { timeout: 10000 });
        reachable = true;
      } catch (error) {
        // Domain not reachable
      }

      return {
        domain,
        dns_configured: dnsStatus,
        reachable,
        records: records.length,
        cloudflare_proxy: records.some(r => r.proxied)
      };
    } catch (error) {
      logger.error(`Failed to check domain status for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Bulk domain operations
   */
  async bulkDomainSetup(domains, ipAddress) {
    const results = [];
    
    for (const domain of domains) {
      try {
        const result = await this.setupTenantCloudflare(domain, ipAddress);
        results.push({
          domain,
          success: true,
          result
        });
      } catch (error) {
        results.push({
          domain,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = CloudflareService;