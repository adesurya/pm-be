# DNS Configuration Guide untuk News CMS SaaS

## Overview
Platform News CMS SaaS mendukung dua pendekatan domain untuk multi-tenant:
1. **Subdomain Approach**: tenant1.yourdomain.com, tenant2.yourdomain.com
2. **Custom Domain Approach**: customdomain.com, anotherdomain.com

## 1. Subdomain Approach

### DNS Configuration
```
*.yourdomain.com    A    YOUR_SERVER_IP
yourdomain.com      A    YOUR_SERVER_IP
```

### Cloudflare Configuration
1. Login ke Cloudflare Dashboard
2. Pilih domain Anda
3. Tambahkan DNS record:
   ```
   Type: A
   Name: *
   IPv4 address: YOUR_SERVER_IP
   Proxy status: Proxied (orange cloud)
   ```

### NGINX Configuration
```nginx
server {
    listen 80;
    server_name *.yourdomain.com yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name *.yourdomain.com yourdomain.com;
    
    # SSL Certificate (Wildcard)
    ssl_certificate /path/to/ssl/certificate.pem;
    ssl_certificate_key /path/to/ssl/private.key;
    
    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 2. Custom Domain Approach

### DNS Configuration untuk Tenant
Setiap tenant perlu mengkonfigurasi DNS domain mereka:

```
customdomain.com    A    YOUR_SERVER_IP
www.customdomain.com    CNAME    customdomain.com
```

### NGINX Configuration untuk Multiple Domains
```nginx
server {
    listen 80;
    server_name customdomain1.com www.customdomain1.com customdomain2.com www.customdomain2.com;
    
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name customdomain1.com www.customdomain1.com customdomain2.com www.customdomain2.com;
    
    # Dynamic SSL certificate (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/$server_name/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$server_name/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 3. Automated SSL Certificate Management

### Install Certbot
```bash
sudo apt update
sudo apt install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

### Wildcard Certificate (Subdomain Approach)
```bash
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials ~/.secrets/certbot/cloudflare.ini \
  -d yourdomain.com \
  -d *.yourdomain.com
```

### Individual Certificates (Custom Domain Approach)
```bash
sudo certbot certonly \
  --nginx \
  -d customdomain.com \
  -d www.customdomain.com
```

### Auto-renewal Setup
```bash
sudo crontab -e
```
Add this line:
```
0 12 * * * /usr/bin/certbot renew --quiet && systemctl reload nginx
```

## 4. Load Balancer Configuration (Production)

### HAProxy Configuration
```
global
    daemon
    maxconn 4096
    
defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    
frontend web_frontend
    bind *:80
    bind *:443 ssl crt /etc/ssl/certs/
    redirect scheme https if !{ ssl_fc }
    
    # ACL for different tenants
    acl tenant1 hdr(host) -i tenant1.yourdomain.com
    acl tenant2 hdr(host) -i tenant2.yourdomain.com
    acl custom1 hdr(host) -i customdomain1.com
    acl custom2 hdr(host) -i customdomain2.com
    
    # Route to backend servers
    use_backend web_servers
    
backend web_servers
    balance roundrobin
    server web1 127.0.0.1:3000 check
    server web2 127.0.0.1:3001 check
    server web3 127.0.0.1:3002 check
```

## 5. Cloudflare Configuration (Recommended)

### Benefits
- DDoS protection
- CDN (Content Delivery Network)
- SSL/TLS termination
- Page rules untuk caching
- Web Application Firewall (WAF)

### Configuration Steps
1. **Add Domain to Cloudflare**
   - Login ke Cloudflare
   - Click "Add Site"
   - Enter your domain
   - Choose plan (Free plan is sufficient to start)

2. **DNS Records**
   ```
   Type: A
   Name: @
   IPv4: YOUR_SERVER_IP
   Proxy: Proxied
   
   Type: A
   Name: *
   IPv4: YOUR_SERVER_IP
   Proxy: Proxied
   
   Type: CNAME
   Name: www
   Target: yourdomain.com
   Proxy: Proxied
   ```

3. **SSL/TLS Settings**
   - SSL/TLS encryption mode: Full (strict)
   - Always Use HTTPS: On
   - HTTP Strict Transport Security (HSTS): Enabled
   - Minimum TLS Version: 1.2

4. **Page Rules**
   ```
   URL: *.yourdomain.com/api/*
   Settings: Cache Level: Bypass
   
   URL: *.yourdomain.com/uploads/*
   Settings: Cache Level: Cache Everything, Edge Cache TTL: 1 month
   
   URL: *.yourdomain.com/*
   Settings: Cache Level: Standard, Browser Cache TTL: 4 hours
   ```

## 6. Monitoring & Health Checks

### Server Health Check
```nginx
location /health {
    access_log off;
    return 200 "healthy\n";
    add_header Content-Type text/plain;
}
```

### Domain Monitoring Script
```bash
#!/bin/bash
# check-domains.sh

DOMAINS=("tenant1.yourdomain.com" "tenant2.yourdomain.com" "customdomain.com")

for domain in "${DOMAINS[@]}"; do
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "https://$domain/health")
    
    if [ $status_code -eq 200 ]; then
        echo "$domain: OK"
    else
        echo "$domain: ERROR (Status: $status_code)"
        # Send alert notification here
    fi
done
```

## 7. Environment Variables untuk DNS

### .env Configuration
```bash
# Domain Configuration
MAIN_DOMAIN=yourdomain.com
ALLOW_CUSTOM_DOMAINS=true
REQUIRE_SSL=true

# Cloudflare Integration
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ZONE_ID=your_zone_id

# SSL Configuration
SSL_CERT_PATH=/etc/letsencrypt/live/
AUTO_SSL=true
```

## 8. Security Considerations

### 1. Domain Validation
```javascript
// utils/domainValidator.js
const validateDomain = (domain) => {
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  return domainRegex.test(domain);
};

const isAllowedDomain = async (domain) => {
  // Check against whitelist
  const allowedDomains = await getAllowedDomains();
  return allowedDomains.includes(domain);
};
```

### 2. Rate Limiting per Domain
```javascript
const domainRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    const domain = req.get('host');
    // Different limits based on tenant plan
    return getTenantRateLimit(domain);
  },
  keyGenerator: (req) => {
    return req.get('host') + ':' + req.ip;
  }
});
```

### 3. CORS Configuration per Tenant
```javascript
const corsOptions = {
  origin: (origin, callback) => {
    const tenant = getTenantByDomain(origin);
    if (tenant && tenant.isActive()) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
```

## 9. Deployment Checklist

- [ ] Server dengan IP static
- [ ] Domain registration dan DNS configuration
- [ ] SSL certificate installation
- [ ] NGINX/Apache configuration
- [ ] Firewall configuration (ports 80, 443)
- [ ] Database server setup
- [ ] Redis server setup
- [ ] Application deployment
- [ ] Environment variables configuration
- [ ] Health checks setup
- [ ] Monitoring dan logging
- [ ] Backup strategy
- [ ] Security hardening

## 10. Troubleshooting

### Common Issues

1. **Domain tidak resolve**
   ```bash
   nslookup yourdomain.com
   ping yourdomain.com
   ```

2. **SSL Certificate issues**
   ```bash
   sudo certbot certificates
   sudo nginx -t
   sudo systemctl reload nginx
   ```

3. **Application tidak accessible**
   ```bash
   sudo systemctl status nginx
   sudo journalctl -u nginx -f
   curl -I http://localhost:3000/health
   ```

4. **Database connection issues**
   ```bash
   mysql -h localhost -u root -p
   redis-cli ping
   ```


# News CMS SaaS - Complete API Documentation

## Base URL
```
https://yourdomain.com/api
```

## Authentication
All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Rate Limiting
- General endpoints: 100 requests per 15 minutes
- Auth endpoints: 5 requests per 15 minutes  
- API endpoints: 1000 requests per 15 minutes
- Upload endpoints: 50 requests per 1 hour

## Response Format
All API responses follow this structure:
```json
{
  "success": true|false,
  "message": "Response message",
  "data": { /* Response data */ },
  "errors": [ /* Validation errors if any */ ],
  "pagination": { /* Pagination info if applicable */ }
}
```

---

## 🔐 Authentication Endpoints

### POST /api/auth/register
Register new user account.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "first_name": "John",
  "last_name": "Doe",
  "role": "contributor"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "role": "contributor",
      "status": "active"
    },
    "tokens": {
      "access_token": "jwt_token",
      "refresh_token": "refresh_token",
      "token_type": "Bearer",
      "expires_in": "24h"
    }
  }
}
```

### POST /api/auth/login
User login.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### POST /api/auth/refresh
Refresh access token.

**Body:**
```json
{
  "refresh_token": "your_refresh_token"
}
```

### POST /api/auth/logout
Logout user and invalidate session.

**Headers:** `Authorization: Bearer <token>`

### GET /api/auth/profile
Get current user profile.

**Headers:** `Authorization: Bearer <token>`

### PUT /api/auth/profile
Update user profile.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "bio": "User bio",
  "phone": "+1234567890",
  "timezone": "UTC",
  "language": "en"
}
```

### PUT /api/auth/change-password
Change user password.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "current_password": "OldPass123!",
  "new_password": "NewPass123!"
}
```

### POST /api/auth/forgot-password
Request password reset.

**Body:**
```json
{
  "email": "user@example.com"
}
```

### POST /api/auth/reset-password
Reset password with token.

**Body:**
```json
{
  "token": "reset_token",
  "new_password": "NewPass123!"
}
```

---

## 📰 News/Articles Endpoints

### GET /api/news/published
Get published articles (public).

**Query Parameters:**
- `page` (int): Page number (default: 1)
- `limit` (int): Items per page (max: 50, default: 10)
- `category_id` (uuid): Filter by category
- `tag_id` (uuid): Filter by tag
- `search` (string): Search in title/content
- `sort` (string): Sort field (published_at, title, views_count)
- `featured` (boolean): Filter featured articles
- `breaking` (boolean): Filter breaking news

### GET /api/news/featured
Get featured articles.

**Query Parameters:**
- `limit` (int): Number of articles (max: 20, default: 5)

### GET /api/news/breaking
Get breaking news articles.

**Query Parameters:**
- `limit` (int): Number of articles (max: 10, default: 3)

### GET /api/news/popular
Get popular articles.

**Query Parameters:**
- `limit` (int): Number of articles (max: 50, default: 10)
- `days` (int): Time period in days (default: 7)

### GET /api/news
Get all articles (authenticated).

**Headers:** `Authorization: Bearer <token>`
**Query Parameters:**
- `page`, `limit`, `search`, `sort` (same as published)
- `status` (string): draft, review, published, archived
- `author_id` (uuid): Filter by author
- `category_id` (uuid): Filter by category

### GET /api/news/:id
Get single article by ID or slug.

**Headers:** `Authorization: Bearer <token>`

### POST /api/news
Create new article.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "title": "Article Title",
  "content": "<p>Article content HTML</p>",
  "excerpt": "Short description",
  "category_id": "uuid",
  "tags": ["tag1", "tag2"],
  "status": "draft",
  "visibility": "public",
  "featured_image": "https://example.com/image.jpg",
  "featured_image_alt": "Image description",
  "meta_title": "SEO title",
  "meta_description": "SEO description",
  "meta_keywords": "keyword1, keyword2",
  "is_featured": false,
  "is_breaking": false,
  "allow_comments": true,
  "scheduled_at": "2024-01-01T10:00:00Z"
}
```

### PUT /api/news/:id
Update article.

**Headers:** `Authorization: Bearer <token>`
**Body:** Same as create (all fields optional)

### DELETE /api/news/:id
Delete article.

**Headers:** `Authorization: Bearer <token>`

### POST /api/news/:id/publish
Publish or unpublish article.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "action": "publish" // or "unpublish"
}
```

### POST /api/news/bulk
Bulk operations on articles.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "action": "publish", // publish, unpublish, delete, feature, unfeature
  "article_ids": ["uuid1", "uuid2"]
}
```

### GET /api/news/stats
Get news statistics (Editor+ only).

**Headers:** `Authorization: Bearer <token>`

### POST /api/news/:id/like
Like article.

**Headers:** `Authorization: Bearer <token>`

### POST /api/news/:id/share
Track article share (public).

---

## 📁 Categories Endpoints

### GET /api/categories
Get all categories.

**Query Parameters:**
- `page`, `limit` (pagination)
- `search` (string): Search in name/description
- `parent_id` (uuid): Filter by parent (use "null" for root categories)
- `featured` (boolean): Filter featured categories
- `active` (boolean): Filter active categories (default: true)
- `with_posts` (boolean): Include post counts

### GET /api/categories/tree
Get category hierarchy tree.

### GET /api/categories/popular
Get popular categories by article count.

**Query Parameters:**
- `limit` (int): Number of categories (default: 10)

### GET /api/categories/counts
Get categories with article counts.

### GET /api/categories/:id
Get single category by ID or slug.

### POST /api/categories
Create new category.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "name": "Category Name",
  "description": "Category description",
  "color": "#3B82F6",
  "image": "https://example.com/image.jpg",
  "parent_id": "uuid", // optional
  "sort_order": 0,
  "is_featured": false,
  "meta_title": "SEO title",
  "meta_description": "SEO description",
  "meta_keywords": "keywords"
}
```

### PUT /api/categories/:id
Update category.

**Headers:** `Authorization: Bearer <token>`
**Body:** Same as create (all fields optional)

### DELETE /api/categories/:id
Delete category.

**Headers:** `Authorization: Bearer <token>`

### POST /api/categories/reorder
Reorder categories.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "category_ids": ["uuid1", "uuid2", "uuid3"]
}
```

---

## 🏷️ Tags Endpoints

### GET /api/tags
Get all tags.

**Query Parameters:**
- `page`, `limit` (pagination)
- `search` (string): Search in tag names
- `active` (boolean): Filter active tags (default: true)
- `min_usage` (int): Minimum usage count

### GET /api/tags/popular
Get popular tags by usage count.

**Query Parameters:**
- `limit` (int): Number of tags (default: 20)

### GET /api/tags/trending
Get trending tags (used in recent articles).

**Query Parameters:**
- `limit` (int): Number of tags (default: 10)
- `days` (int): Time period in days (default: 30)

### GET /api/tags/cloud
Get tag cloud data.

**Query Parameters:**
- `min_count` (int): Minimum usage count (default: 1)

### GET /api/tags/unused
Get unused tags (usage_count = 0).

### GET /api/tags/stats
Get tag statistics.

### GET /api/tags/:id
Get single tag by ID or slug.

### POST /api/tags
Create new tag.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "name": "tag-name",
  "description": "Tag description",
  "color": "#3B82F6",
  "meta_title": "SEO title",
  "meta_description": "SEO description"
}
```

### PUT /api/tags/:id
Update tag.

**Headers:** `Authorization: Bearer <token>`
**Body:** Same as create (all fields optional)

### DELETE /api/tags/:id
Delete tag.

**Headers:** `Authorization: Bearer <token>`

### POST /api/tags/cleanup
Clean up unused tags.

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "min_usage": 0,
  "older_than_days": 30
}
```

---

## 👥 Users Endpoints

### GET /api/users
Get all users (Admin only).

**Headers:** `Authorization: Bearer <token>`
**Query Parameters:**
- `page`, `limit` (pagination)
- `search` (string): Search in name/email
- `role` (string): Filter by role
- `status` (string): Filter by status

### GET /api/users/:id
Get single user.

**Headers:** `Authorization: Bearer <token>`

### POST /api/users
Create new user (Admin only).

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "first_name": "John",
  "last_name": "Doe",
  "role": "contributor",
  "status": "active"
}
```

### PUT /api/users/:id
Update user (Admin or self).

**Headers:** `Authorization: Bearer <token>`
**Body:** Same as create (all fields optional except password)

### DELETE /api/users/:id
Delete user (Admin only).

**Headers:** `Authorization: Bearer <token>`

### POST /api/users/:id/status
Change user status (Admin only).

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "status": "active" // active, inactive, suspended
}
```

---

## 🏢 Tenant Management Endpoints

### GET /api/tenants/info
Get current tenant information.

**Headers:** `Authorization: Bearer <token>`

### PUT /api/tenants/settings
Update tenant settings (Admin only).

**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "settings": {
    "theme": "default",
    "language": "en",
    "timezone": "UTC",
    "features": {
      "analytics": true,
      "seo": true
    }
  }
}
```

### GET /api/tenants/stats
Get tenant usage statistics (Admin only).

**Headers:** `Authorization: Bearer <token>`

---

## 📤 File Upload Endpoints

### POST /api/upload/image
Upload image file.

**Headers:** `Authorization: Bearer <token>`
**Content-Type:** `multipart/form-data`
**Body:** Form data with `file` field

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://yourdomain.com/uploads/images/filename.jpg",
    "filename": "filename.jpg",
    "size": 1024,
    "mimetype": "image/jpeg"
  }
}
```

### POST /api/upload/document
Upload document file.

**Headers:** `Authorization: Bearer <token>`
**Content-Type:** `multipart/form-data`

### DELETE /api/upload/:filename
Delete uploaded file.

**Headers:** `Authorization: Bearer <token>`

---

## 🔍 Search Endpoints

### GET /api/search
Global search across articles, categories, and tags.

**Query Parameters:**
- `q` (string): Search query
- `type` (string): articles, categories, tags, all (default: all)
- `limit` (int): Results per type (default: 10)

### GET /api/search/suggestions
Get search suggestions.

**Query Parameters:**
- `q` (string): Partial search query
- `limit` (int): Number of suggestions (default: 5)

---

## 📊 Analytics Endpoints

### GET /api/analytics/overview
Get analytics overview (Admin/Editor only).

**Headers:** `Authorization: Bearer <token>`
**Query Parameters:**
- `period` (string): today, week, month, year
- `start_date` (date): Custom start date
- `end_date` (date): Custom end date

### GET /api/analytics/articles
Get article performance analytics.

**Headers:** `Authorization: Bearer <token>`

### GET /api/analytics/popular
Get popular content analytics.

**Headers:** `Authorization: Bearer <token>`

---

## ⚙️ System Endpoints

### GET /api/csrf-token
Get CSRF token for form submissions.

### GET /health
Health check endpoint.

### GET /api/docs
API documentation endpoint.

---

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_FAILED` | Request validation failed |
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `TENANT_NOT_FOUND` | Tenant domain not found |
| `USER_EXISTS` | User with email already exists |
| `INVALID_CREDENTIALS` | Invalid login credentials |
| `TOKEN_EXPIRED` | JWT token has expired |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `LIMIT_EXCEEDED` | Tenant resource limit exceeded |
| `FEATURE_NOT_AVAILABLE` | Feature not available in current plan |

---

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request / Validation Error
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `413` - Payload Too Large
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error

---

## Examples

### Complete Article Creation Flow

1. **Login**
```bash
curl -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass"}'
```

2. **Create Category**
```bash
curl -X POST https://yourdomain.com/api/categories \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Technology","color":"#3B82F6"}'
```

3. **Upload Image**
```bash
curl -X POST https://yourdomain.com/api/upload/image \
  -H "Authorization: Bearer <token>" \
  -F "file=@image.jpg"
```

4. **Create Article**
```bash
curl -X POST https://yourdomain.com/api/news \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"My First Article",
    "content":"<p>Article content</p>",
    "category_id":"category-uuid",
    "featured_image":"uploaded-image-url",
    "status":"published"
  }'
```

5. **Publish Article**
```bash
curl -X POST https://yourdomain.com/api/news/<article-id>/publish \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"publish"}'
```