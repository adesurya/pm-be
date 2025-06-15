// middleware/security.js
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const sanitizeHtml = require('sanitize-html');
const path = require('path');

/**
 * Content Security Policy configuration
 */
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://cdnjs.cloudflare.com",
      "https://fonts.googleapis.com"
    ],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "https://cdnjs.cloudflare.com"
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com",
      "https://cdnjs.cloudflare.com"
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https:",
      "http:"
    ],
    connectSrc: [
      "'self'",
      "https:",
      "wss:"
    ],
    mediaSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    childSrc: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    upgradeInsecureRequests: []
  },
  reportOnly: false,
  reportUri: process.env.CSP_REPORT_URI || '/api/csp-report'
};

/**
 * Rate limiting configurations
 */
const createRateLimit = (windowMs, max, message, skipSuccessfulRequests = false) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      console.warn(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      res.status(429).json({
        success: false,
        message,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
};

// Different rate limits for different endpoints
const generalRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // requests per window
  'Too many requests, please try again later'
);

const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  5, // requests per window
  'Too many authentication attempts, please try again later'
);

const apiRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  1000, // requests per window
  'API rate limit exceeded'
);

const uploadRateLimit = createRateLimit(
  60 * 60 * 1000, // 1 hour
  50, // requests per window
  'Too many upload attempts, please try again later'
);

/**
 * XSS Protection middleware
 */
const xssProtection = (req, res, next) => {
  // Clean request body
  if (req.body && typeof req.body === 'object') {
    req.body = cleanObject(req.body);
  }

  // Clean query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = cleanObject(req.query);
  }

  next();
};

/**
 * Clean object recursively from XSS
 */
const cleanObject = (obj) => {
  if (typeof obj === 'string') {
    return xss(obj, {
      whiteList: {
        p: [],
        br: [],
        strong: [],
        em: [],
        u: [],
        ol: [],
        ul: [],
        li: [],
        h1: [],
        h2: [],
        h3: [],
        h4: [],
        h5: [],
        h6: [],
        blockquote: [],
        a: ['href', 'title', 'target'],
        img: ['src', 'alt', 'title', 'width', 'height']
      },
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanObject);
  }

  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = cleanObject(value);
    }
    return cleaned;
  }

  return obj;
};

/**
 * HTML Sanitization for rich content
 */
const sanitizeHtmlContent = (content) => {
  return sanitizeHtml(content, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'a', 'img', 'div', 'span', 'table', 'thead', 'tbody',
      'tr', 'td', 'th', 'pre', 'code'
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'div': ['class'],
      'span': ['class'],
      'table': ['class'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      'a': (tagName, attribs) => {
        // Add rel="noopener noreferrer" to external links
        if (attribs.href && attribs.href.startsWith('http')) {
          attribs.rel = 'noopener noreferrer';
          if (!attribs.target) {
            attribs.target = '_blank';
          }
        }
        return { tagName, attribs };
      }
    }
  });
};

/**
 * Path validation to prevent LFI/RFI
 */
const validatePath = (filePath) => {
  // Normalize path
  const normalizedPath = path.normalize(filePath);
  
  // Check for directory traversal attempts
  if (normalizedPath.includes('../') || normalizedPath.includes('..\\')) {
    return false;
  }
  
  // Check for absolute paths
  if (path.isAbsolute(normalizedPath)) {
    return false;
  }
  
  // Check for null bytes
  if (normalizedPath.includes('\0')) {
    return false;
  }
  
  return true;
};

/**
 * File upload security validation
 */
const validateFileUpload = (file, allowedTypes, maxSize) => {
  const errors = [];
  
  // Check file type
  if (allowedTypes && !allowedTypes.includes(file.mimetype)) {
    errors.push('Invalid file type');
  }
  
  // Check file size
  if (maxSize && file.size > maxSize) {
    errors.push('File size exceeds limit');
  }
  
  // Check filename for security issues
  if (!validatePath(file.originalname)) {
    errors.push('Invalid filename');
  }
  
  // Check for executable extensions
  const dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js',
    '.jar', '.sh', '.php', '.asp', '.aspx', '.jsp'
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  if (dangerousExtensions.includes(ext)) {
    errors.push('File type not allowed');
  }
  
  return errors;
};

/**
 * IP Whitelist middleware (for admin endpoints)
 */
const ipWhitelist = (allowedIPs) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (allowedIPs && allowedIPs.length > 0) {
      if (!allowedIPs.includes(clientIP)) {
        console.warn(`Unauthorized IP access attempt: ${clientIP}`);
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          code: 'IP_NOT_ALLOWED'
        });
      }
    }
    
    next();
  };
};

/**
 * Security headers middleware
 */
const securityHeaders = helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? cspConfig : false,
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false,
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
});

/**
 * Request logging for security monitoring
 */
const securityLogger = (req, res, next) => {
  // Log suspicious requests
  const suspiciousPatterns = [
    /\.\./,
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /onload=/i,
    /onerror=/i,
    /eval\(/i,
    /union.*select/i,
    /insert.*into/i,
    /delete.*from/i,
    /drop.*table/i
  ];
  
  const requestData = JSON.stringify({
    url: req.url,
    body: req.body,
    query: req.query,
    headers: req.headers
  });
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      console.warn(`Suspicious request detected from IP: ${req.ip}`, {
        url: req.url,
        method: req.method,
        userAgent: req.get('User-Agent'),
        body: req.body,
        query: req.query
      });
      break;
    }
  }
  
  next();
};

module.exports = {
  securityHeaders,
  generalRateLimit,
  authRateLimit,
  apiRateLimit,
  uploadRateLimit,
  xssProtection,
  sanitizeHtmlContent,
  validatePath,
  validateFileUpload,
  ipWhitelist,
  securityLogger,
  createRateLimit
};