// services/tenantAutomationService.js
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const logger = require('../utils/logger');
const { createTenantDB, initializeTenantModels } = require('../config/database');

class TenantAutomationService {
  constructor() {
    this.nginxConfigPath = '/etc/nginx/sites-available';
    this.nginxEnabledPath = '/etc/nginx/sites-enabled';
    this.sslCertPath = '/etc/letsencrypt/live';
    this.cloudflareApiUrl = 'https://api.cloudflare.com/client/v4';
    this.cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.cloudflareZoneId = process.env.CLOUDFLARE_ZONE_ID;
  }

  /**
   * Automatically provision new tenant with custom domain
   */
  async provisionTenant(tenantData) {
    const { domain, subdomain, name, contact_email, contact_name, plan = 'trial' } = tenantData;
    
    try {
      logger.info(`Starting tenant provisioning for domain: ${domain}`);
      
      // Step 1: Create tenant in database
      const tenant = await this.createTenantRecord(tenantData);
      
      // Step 2: Create tenant database
      await this.createTenantDatabase(tenant.id);
      
      // Step 3: Setup DNS (if using Cloudflare)
      if (this.cloudflareApiToken && domain !== `${subdomain}.${process.env.MAIN_DOMAIN}`) {
        await this.setupCloudflareRecord(domain);
      }
      
      // Step 4: Generate SSL certificate
      await this.generateSSLCertificate(domain);
      
      // Step 5: Update NGINX configuration
      await this.updateNginxConfiguration(domain);
      
      // Step 6: Reload NGINX
      await this.reloadNginx();
      
      // Step 7: Verify setup
      await this.verifyTenantSetup(domain);
      
      // Step 8: Create default admin user
      await this.createDefaultAdminUser(tenant.id, contact_email, contact_name);
      
      logger.info(`✅ Tenant provisioning completed successfully for: ${domain}`);
      
      return {
        success: true,
        tenant,
        message: 'Tenant provisioned successfully',
        setup_details: {
          domain,
          ssl_enabled: true,
          nginx_configured: true,
          database_created: true,
          admin_created: true
        }
      };
      
    } catch (error) {
      logger.error(`❌ Tenant provisioning failed for ${domain}:`, error);
      
      // Cleanup on failure
      await this.cleanupFailedProvisioning(domain, tenantData.id);
      
      throw new Error(`Tenant provisioning failed: ${error.message}`);
    }
  }

  /**
   * Create tenant record in master database
   */
  async createTenantRecord(tenantData) {
    const Tenant = require('../models/Tenant');
    
    return await Tenant.create({
      name: tenantData.name,
      domain: tenantData.domain,
      subdomain: tenantData.subdomain,
      contact_email: tenantData.contact_email,
      contact_name: tenantData.contact_name,
      status: 'provisioning',
      plan: tenantData.plan || 'trial'
    });
  }

  /**
   * Create tenant database and initialize models
   */
  async createTenantDatabase(tenantId) {
    logger.info(`Creating database for tenant: ${tenantId}`);
    
    await createTenantDB(tenantId);
    const tenantDB = await getTenantDB(tenantId);
    await initializeTenantModels(tenantDB);
    
    logger.info(`✅ Database created for tenant: ${tenantId}`);
  }

  /**
   * Setup Cloudflare DNS record automatically
   */
  async setupCloudflareRecord(domain) {
    if (!this.cloudflareApiToken) {
      logger.warn('Cloudflare API token not configured, skipping DNS setup');
      return;
    }

    try {
      logger.info(`Setting up Cloudflare DNS record for: ${domain}`);
      
      const headers = {
        'Authorization': `Bearer ${this.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      };

      // Check if record already exists
      const existingRecords = await axios.get(
        `${this.cloudflareApiUrl}/zones/${this.cloudflareZoneId}/dns_records?name=${domain}`,
        { headers }
      );

      if (existingRecords.data.result.length > 0) {
        logger.info(`DNS record already exists for: ${domain}`);
        return;
      }

      // Create A record
      const recordData = {
        type: 'A',
        name: domain,
        content: process.env.SERVER_IP,
        ttl: 300,
        proxied: true
      };

      const response = await axios.post(
        `${this.cloudflareApiUrl}/zones/${this.cloudflareZoneId}/dns_records`,
        recordData,
        { headers }
      );

      if (response.data.success) {
        logger.info(`✅ Cloudflare DNS record created for: ${domain}`);
      } else {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response.data.errors)}`);
      }

    } catch (error) {
      logger.error(`❌ Failed to setup Cloudflare DNS for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Generate SSL certificate using Let's Encrypt
   */
  async generateSSLCertificate(domain) {
    try {
      logger.info(`Generating SSL certificate for: ${domain}`);
      
      // Check if certificate already exists
      const certPath = path.join(this.sslCertPath, domain);
      try {
        await fs.access(certPath);
        logger.info(`SSL certificate already exists for: ${domain}`);
        return;
      } catch (error) {
        // Certificate doesn't exist, create it
      }

      // Generate certificate using certbot
      let certbotCommand;
      
      if (this.cloudflareApiToken) {
        // Use DNS challenge with Cloudflare
        certbotCommand = `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini -d ${domain} --non-interactive --agree-tos --email ${process.env.ADMIN_EMAIL}`;
      } else {
        // Use HTTP challenge
        certbotCommand = `certbot certonly --webroot -w /var/www/html -d ${domain} --non-interactive --agree-tos --email ${process.env.ADMIN_EMAIL}`;
      }

      logger.info(`Running certbot command: ${certbotCommand}`);
      execSync(certbotCommand, { stdio: 'inherit' });
      
      logger.info(`✅ SSL certificate generated for: ${domain}`);
      
    } catch (error) {
      logger.error(`❌ Failed to generate SSL certificate for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Update NGINX configuration with new domain
   */
  async updateNginxConfiguration(domain) {
    try {
      logger.info(`Updating NGINX configuration for: ${domain}`);
      
      const configTemplate = await this.generateNginxConfig(domain);
      const configPath = path.join(this.nginxConfigPath, `${domain}.conf`);
      const enabledPath = path.join(this.nginxEnabledPath, `${domain}.conf`);
      
      // Write configuration file
      await fs.writeFile(configPath, configTemplate);
      
      // Create symlink to enabled sites
      try {
        await fs.symlink(configPath, enabledPath);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      
      // Test NGINX configuration
      execSync('nginx -t', { stdio: 'inherit' });
      
      logger.info(`✅ NGINX configuration updated for: ${domain}`);
      
    } catch (error) {
      logger.error(`❌ Failed to update NGINX configuration for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Generate NGINX configuration template for domain
   */
  async generateNginxConfig(domain) {
    const sslCertPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
    const sslKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
    
    return `
# Auto-generated configuration for ${domain}
# Generated at: ${new Date().toISOString()}

# Rate limiting
limit_req_zone $binary_remote_addr zone=${domain.replace(/\./g, '_')}_api:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=${domain.replace(/\./g, '_')}_auth:10m rate=5r/m;

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name ${domain};

    # SSL Configuration
    ssl_certificate ${sslCertPath};
    ssl_certificate_key ${sslKeyPath};
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Client settings
    client_max_body_size 10M;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Static files
    location /uploads/ {
        alias /var/www/newscms/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # API endpoints with rate limiting
    location /api/auth/ {
        limit_req zone=${domain.replace(/\./g, '_')}_auth burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        limit_req zone=${domain.replace(/\./g, '_')}_api burst=50 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Main application
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location = /health {
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }

    # Logs
    access_log /var/log/nginx/${domain}-access.log;
    error_log /var/log/nginx/${domain}-error.log;
}
`;
  }

  /**
   * Reload NGINX configuration
   */
  async reloadNginx() {
    try {
      logger.info('Reloading NGINX configuration');
      execSync('systemctl reload nginx', { stdio: 'inherit' });
      logger.info('✅ NGINX reloaded successfully');
    } catch (error) {
      logger.error('❌ Failed to reload NGINX:', error);
      throw error;
    }
  }

  /**
   * Verify tenant setup by making HTTP request
   */
  async verifyTenantSetup(domain) {
    try {
      logger.info(`Verifying tenant setup for: ${domain}`);
      
      // Wait a bit for DNS propagation
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const response = await axios.get(`https://${domain}/health`, {
        timeout: 30000,
        validateStatus: (status) => status === 200
      });
      
      if (response.status === 200) {
        logger.info(`✅ Tenant verification successful for: ${domain}`);
      } else {
        throw new Error(`Health check failed with status: ${response.status}`);
      }
      
    } catch (error) {
      logger.error(`❌ Tenant verification failed for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Create default admin user for new tenant
   */
  async createDefaultAdminUser(tenantId, email, name) {
    try {
      logger.info(`Creating default admin user for tenant: ${tenantId}`);
      
      const { getTenantDB, initializeTenantModels } = require('../config/database');
      const tenantDB = await getTenantDB(tenantId);
      const models = await initializeTenantModels(tenantDB);
      
      // Generate random password
      const password = this.generateRandomPassword();
      
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || 'Admin';
      const lastName = nameParts.slice(1).join(' ') || 'User';
      
      const adminUser = await models.User.create({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        role: 'admin',
        status: 'active',
        email_verified: true
      });
      
      logger.info(`✅ Default admin user created for tenant: ${tenantId}`);
      
      // TODO: Send welcome email with login credentials
      await this.sendWelcomeEmail(email, password, tenantId);
      
      return { email, password, user_id: adminUser.id };
      
    } catch (error) {
      logger.error(`❌ Failed to create admin user for tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Generate random secure password
   */
  generateRandomPassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    
    // Ensure password has at least one of each required character type
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
    password += '0123456789'[Math.floor(Math.random() * 10)]; // digit
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)]; // special
    
    // Fill remaining length
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Send welcome email to new tenant admin
   */
  async sendWelcomeEmail(email, password, tenantId) {
    try {
      // TODO: Implement email sending
      logger.info(`Welcome email should be sent to: ${email}`);
      logger.info(`Temporary password: ${password}`);
      
      // You can integrate with services like:
      // - SendGrid
      // - AWS SES
      // - Mailgun
      // - Postmark
      
    } catch (error) {
      logger.error('Failed to send welcome email:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Cleanup failed provisioning
   */
  async cleanupFailedProvisioning(domain, tenantId) {
    try {
      logger.info(`Cleaning up failed provisioning for: ${domain}`);
      
      // Remove NGINX configuration
      const configPath = path.join(this.nginxConfigPath, `${domain}.conf`);
      const enabledPath = path.join(this.nginxEnabledPath, `${domain}.conf`);
      
      try {
        await fs.unlink(enabledPath);
        await fs.unlink(configPath);
      } catch (error) {
        // Ignore if files don't exist
      }
      
      // Remove SSL certificate
      try {
        execSync(`certbot delete --cert-name ${domain} --non-interactive`, { stdio: 'ignore' });
      } catch (error) {
        // Ignore if certificate doesn't exist
      }
      
      // Remove DNS record (if using Cloudflare)
      if (this.cloudflareApiToken) {
        try {
          await this.removeCloudflareRecord(domain);
        } catch (error) {
          logger.error('Failed to remove Cloudflare record:', error);
        }
      }
      
      // Remove tenant database
      if (tenantId) {
        try {
          const dbName = `news_cms_tenant_${tenantId}`;
          const { masterDB } = require('../config/database');
          await masterDB.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        } catch (error) {
          logger.error('Failed to remove tenant database:', error);
        }
      }
      
      // Remove tenant record
      if (tenantId) {
        try {
          const Tenant = require('../models/Tenant');
          await Tenant.destroy({ where: { id: tenantId } });
        } catch (error) {
          logger.error('Failed to remove tenant record:', error);
        }
      }
      
      // Reload NGINX
      try {
        await this.reloadNginx();
      } catch (error) {
        logger.error('Failed to reload NGINX during cleanup:', error);
      }
      
      logger.info(`✅ Cleanup completed for: ${domain}`);
      
    } catch (error) {
      logger.error(`❌ Cleanup failed for ${domain}:`, error);
    }
  }

  /**
   * Remove Cloudflare DNS record
   */
  async removeCloudflareRecord(domain) {
    try {
      const headers = {
        'Authorization': `Bearer ${this.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      };

      // Get record ID
      const records = await axios.get(
        `${this.cloudflareApiUrl}/zones/${this.cloudflareZoneId}/dns_records?name=${domain}`,
        { headers }
      );

      for (const record of records.data.result) {
        await axios.delete(
          `${this.cloudflareApiUrl}/zones/${this.cloudflareZoneId}/dns_records/${record.id}`,
          { headers }
        );
      }

      logger.info(`✅ Cloudflare DNS record removed for: ${domain}`);
      
    } catch (error) {
      logger.error(`❌ Failed to remove Cloudflare DNS for ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Deprovision tenant (remove all resources)
   */
  async deprovisionTenant(tenantId) {
    try {
      logger.info(`Starting tenant deprovisioning for: ${tenantId}`);
      
      const Tenant = require('../models/Tenant');
      const tenant = await Tenant.findByPk(tenantId);
      
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      await this.cleanupFailedProvisioning(tenant.domain, tenantId);
      
      logger.info(`✅ Tenant deprovisioning completed for: ${tenantId}`);
      
    } catch (error) {
      logger.error(`❌ Tenant deprovisioning failed for ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Update tenant domain (migration)
   */
  async updateTenantDomain(tenantId, newDomain) {
    try {
      logger.info(`Updating tenant domain from ${tenantId} to ${newDomain}`);
      
      const Tenant = require('../models/Tenant');
      const tenant = await Tenant.findByPk(tenantId);
      
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      const oldDomain = tenant.domain;
      
      // Setup new domain
      if (this.cloudflareApiToken) {
        await this.setupCloudflareRecord(newDomain);
      }
      
      await this.generateSSLCertificate(newDomain);
      await this.updateNginxConfiguration(newDomain);
      
      // Update tenant record
      await tenant.update({ domain: newDomain });
      
      // Clean up old domain
      await this.cleanupFailedProvisioning(oldDomain, null);
      
      await this.reloadNginx();
      
      logger.info(`✅ Tenant domain updated successfully: ${oldDomain} -> ${newDomain}`);
      
    } catch (error) {
      logger.error(`❌ Failed to update tenant domain:`, error);
      throw error;
    }
  }
}

module.exports = TenantAutomationService;