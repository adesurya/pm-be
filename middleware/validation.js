// middleware/validation.js
const { validationResult } = require('express-validator');
const { body, param, query } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation failed:', {
      errors: errors.array(),
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  
  next();
};

/**
 * Common validation rules
 */
const commonValidations = {
  // UUID validation
  uuid: (field = 'id') => 
    param(field)
      .isUUID()
      .withMessage(`${field} must be a valid UUID`),

  // Pagination validation
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Page must be between 1-1000'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1-100'),
    query('sort')
      .optional()
      .isLength({ min: 1, max: 50 })
      .matches(/^[a-zA-Z_]+$/)
      .withMessage('Sort field must contain only letters and underscores'),
    query('order')
      .optional()
      .isIn(['ASC', 'DESC', 'asc', 'desc'])
      .withMessage('Order must be ASC or DESC')
  ],

  // Search validation
  search: 
    query('search')
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .escape()
      .withMessage('Search term must be 1-100 characters'),

  // Email validation
  email: (field = 'email') =>
    body(field)
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),

  // Password validation
  password: (field = 'password') =>
    body(field)
      .isLength({ min: 8, max: 128 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must be 8-128 characters with uppercase, lowercase, number and special character'),

  // Name validation
  name: (field, min = 1, max = 100) =>
    body(field)
      .trim()
      .isLength({ min, max })
      .matches(/^[a-zA-Z\s\-'\.]+$/)
      .withMessage(`${field} must be ${min}-${max} characters and contain only letters, spaces, hyphens, apostrophes, and periods`),

  // Text content validation
  textContent: (field, min = 1, max = 1000) =>
    body(field)
      .trim()
      .isLength({ min, max })
      .withMessage(`${field} must be ${min}-${max} characters`),

  // HTML content validation
  htmlContent: (field, min = 1, max = 65535) =>
    body(field)
      .trim()
      .isLength({ min, max })
      .withMessage(`${field} must be ${min}-${max} characters`),

  // URL validation
  url: (field) =>
    body(field)
      .optional()
      .isURL({
        protocols: ['http', 'https'],
        require_protocol: true
      })
      .withMessage(`${field} must be a valid URL`),

  // Color validation (hex)
  color: (field) =>
    body(field)
      .optional()
      .matches(/^#[0-9A-F]{6}$/i)
      .withMessage(`${field} must be a valid hex color`),

  // Phone validation
  phone: (field) =>
    body(field)
      .optional()
      .isMobilePhone()
      .withMessage(`${field} must be a valid phone number`),

  // Date validation
  date: (field) =>
    body(field)
      .optional()
      .isISO8601()
      .withMessage(`${field} must be a valid date`),

  // Boolean validation
  boolean: (field) =>
    body(field)
      .optional()
      .isBoolean()
      .withMessage(`${field} must be a boolean value`),

  // Array validation
  array: (field, maxItems = 100) =>
    body(field)
      .optional()
      .isArray({ max: maxItems })
      .withMessage(`${field} must be an array with maximum ${maxItems} items`),

  // Enum validation
  enum: (field, values) =>
    body(field)
      .optional()
      .isIn(values)
      .withMessage(`${field} must be one of: ${values.join(', ')}`),

  // File validation
  file: (field, allowedTypes = ['image/jpeg', 'image/png', 'image/gif']) =>
    body(field)
      .optional()
      .custom((value, { req }) => {
        if (req.file && !allowedTypes.includes(req.file.mimetype)) {
          throw new Error(`${field} must be one of: ${allowedTypes.join(', ')}`);
        }
        return true;
      })
};

/**
 * Sanitization middleware
 */
const sanitizeInput = (req, res, next) => {
  // Sanitize string inputs
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        // Remove null bytes
        obj[key] = obj[key].replace(/\0/g, '');
        
        // Trim whitespace
        obj[key] = obj[key].trim();
        
        // Remove control characters except newline and tab
        obj[key] = obj[key].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }

  next();
};

/**
 * Rate limiting validation
 */
const validateRateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  return (req, res, next) => {
    // Check if rate limit headers are present
    const remaining = parseInt(req.get('X-RateLimit-Remaining') || max);
    const reset = parseInt(req.get('X-RateLimit-Reset') || Date.now() + windowMs);
    
    if (remaining <= 0) {
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retry_after: Math.ceil((reset - Date.now()) / 1000)
      });
    }
    
    next();
  };
};

/**
 * Content length validation
 */
const validateContentLength = (maxSize = 10 * 1024 * 1024) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || 0);
    
    if (contentLength > maxSize) {
      return res.status(413).json({
        success: false,
        message: 'Request entity too large',
        code: 'PAYLOAD_TOO_LARGE',
        max_size: maxSize
      });
    }
    
    next();
  };
};

/**
 * Custom validation for business rules
 */
const businessRuleValidations = {
  // Validate article status transition
  articleStatusTransition: 
    body('status')
      .custom(async (value, { req }) => {
        if (!req.currentUser) {
          throw new Error('User not authenticated');
        }

        const allowedTransitions = {
          contributor: ['draft', 'review'],
          editor: ['draft', 'review', 'published', 'archived'],
          admin: ['draft', 'review', 'published', 'archived'],
          super_admin: ['draft', 'review', 'published', 'archived']
        };

        const userRole = req.currentUser.role;
        if (!allowedTransitions[userRole] || !allowedTransitions[userRole].includes(value)) {
          throw new Error(`Your role (${userRole}) cannot set status to ${value}`);
        }

        return true;
      }),

  // Validate category hierarchy
  categoryHierarchy:
    body('parent_id')
      .optional()
      .custom(async (value, { req }) => {
        if (!value || !req.models) return true;

        const categoryId = req.params.id;
        if (value === categoryId) {
          throw new Error('Category cannot be its own parent');
        }

        // Check if parent exists
        const parent = await req.models.Category.findByPk(value);
        if (!parent) {
          throw new Error('Parent category not found');
        }

        // Check for circular reference (if updating existing category)
        if (categoryId) {
          const getDescendants = async (id) => {
            const children = await req.models.Category.findAll({
              where: { parent_id: id },
              attributes: ['id']
            });
            
            let descendants = children.map(child => child.id);
            for (const child of children) {
              const childDescendants = await getDescendants(child.id);
              descendants = descendants.concat(childDescendants);
            }
            
            return descendants;
          };

          const descendants = await getDescendants(categoryId);
          if (descendants.includes(value)) {
            throw new Error('Cannot create circular reference in category hierarchy');
          }
        }

        return true;
      }),

  // Validate tag limits
  tagLimits:
    body('tags')
      .optional()
      .custom(async (value, { req }) => {
        if (!Array.isArray(value)) return true;
        
        const maxTags = req.tenant?.limits?.max_tags_per_article || 10;
        if (value.length > maxTags) {
          throw new Error(`Maximum ${maxTags} tags allowed per article`);
        }

        // Validate each tag
        for (const tag of value) {
          if (typeof tag !== 'string' || tag.length < 2 || tag.length > 50) {
            throw new Error('Each tag must be 2-50 characters');
          }
        }

        return true;
      }),

  // Validate scheduled publish date
  scheduledPublishDate:
    body('scheduled_at')
      .optional()
      .custom((value, { req }) => {
        if (!value) return true;

        const scheduledDate = new Date(value);
        const now = new Date();
        
        if (scheduledDate <= now) {
          throw new Error('Scheduled publish date must be in the future');
        }

        // Check if user can schedule posts
        if (!['super_admin', 'admin', 'editor'].includes(req.currentUser?.role)) {
          throw new Error('You do not have permission to schedule posts');
        }

        return true;
      }),

  // Validate slug uniqueness
  slugUniqueness: (model, excludeId = null) =>
    body('slug')
      .optional()
      .custom(async (value, { req }) => {
        if (!value || !req.models) return true;

        const whereClause = { slug: value };
        if (excludeId && req.params.id) {
          whereClause.id = { [req.db.Sequelize.Op.ne]: req.params.id };
        }

        const existing = await req.models[model].findOne({ where: whereClause });
        if (existing) {
          throw new Error(`${model} with this slug already exists`);
        }

        return true;
      })
};

/**
 * File upload validation
 */
const fileUploadValidation = {
  image: [
    body('file')
      .custom((value, { req }) => {
        if (!req.file) return true;

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const maxSize = 5 * 1024 * 1024; // 5MB

        if (!allowedTypes.includes(req.file.mimetype)) {
          throw new Error('Only JPEG, PNG, GIF, and WebP images are allowed');
        }

        if (req.file.size > maxSize) {
          throw new Error('Image size must be less than 5MB');
        }

        return true;
      })
  ],

  document: [
    body('file')
      .custom((value, { req }) => {
        if (!req.file) return true;

        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        const maxSize = 10 * 1024 * 1024; // 10MB

        if (!allowedTypes.includes(req.file.mimetype)) {
          throw new Error('Only PDF and Word documents are allowed');
        }

        if (req.file.size > maxSize) {
          throw new Error('Document size must be less than 10MB');
        }

        return true;
      })
  ]
};

/**
 * Request context validation
 */
const contextValidation = {
  requireTenant: (req, res, next) => {
    if (!req.tenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant context is required',
        code: 'NO_TENANT_CONTEXT'
      });
    }
    next();
  },

  requireUser: (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User context is required',
        code: 'NO_USER_CONTEXT'
      });
    }
    next();
  },

  requireModels: (req, res, next) => {
    if (!req.models) {
      return res.status(500).json({
        success: false,
        message: 'Database models not available',
        code: 'NO_MODELS'
      });
    }
    next();
  }
};

/**
 * API version validation
 */
const apiVersionValidation = (supportedVersions = ['v1']) => {
  return (req, res, next) => {
    const version = req.headers['api-version'] || req.query.version || 'v1';
    
    if (!supportedVersions.includes(version)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported API version: ${version}`,
        code: 'UNSUPPORTED_VERSION',
        supported_versions: supportedVersions
      });
    }
    
    req.apiVersion = version;
    next();
  };
};

/**
 * Request ID validation for idempotency
 */
const idempotencyValidation = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (req.method === 'POST' && idempotencyKey) {
    // Validate idempotency key format
    if (!/^[a-zA-Z0-9\-_]{1,255}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid idempotency key format',
        code: 'INVALID_IDEMPOTENCY_KEY'
      });
    }
    
    req.idempotencyKey = idempotencyKey;
  }
  
  next();
};

/**
 * Validation helper functions
 */
const validationHelpers = {
  // Check if value is empty
  isEmpty: (value) => {
    return value === undefined || 
           value === null || 
           value === '' || 
           (Array.isArray(value) && value.length === 0) ||
           (typeof value === 'object' && Object.keys(value).length === 0);
  },

  // Validate password strength
  validatePasswordStrength: (password) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      digit: /\d/.test(password),
      special: /[@$!%*?&]/.test(password)
    };

    const score = Object.values(checks).filter(Boolean).length;
    return {
      score,
      checks,
      isStrong: score >= 4
    };
  },

  // Validate email domain
  validateEmailDomain: async (email) => {
    const domain = email.split('@')[1];
    const disposableEmailDomains = [
      '10minutemail.com',
      'tempmail.org',
      'guerrillamail.com'
      // Add more as needed
    ];

    return !disposableEmailDomains.includes(domain.toLowerCase());
  },

  // Validate content for profanity
  validateProfanity: (content) => {
    const profanityWords = [
      // Add profanity words to filter
    ];

    const lowerContent = content.toLowerCase();
    return !profanityWords.some(word => lowerContent.includes(word));
  }
};

/**
 * Custom error formatter
 */
const formatValidationError = (error) => {
  return {
    field: error.param || error.path,
    message: error.msg || error.message,
    value: error.value,
    location: error.location || 'body'
  };
};

/**
 * Validation summary middleware
 */
const validationSummary = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(formatValidationError);
    
    // Group errors by field
    const groupedErrors = formattedErrors.reduce((acc, error) => {
      if (!acc[error.field]) {
        acc[error.field] = [];
      }
      acc[error.field].push(error.message);
      return acc;
    }, {});

    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      errors: groupedErrors,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
      error_summary: groupedErrors
    });
  }

  next();
};

module.exports = {
  handleValidationErrors,
  commonValidations,
  sanitizeInput,
  validateRateLimit,
  validateContentLength,
  businessRuleValidations,
  fileUploadValidation,
  contextValidation,
  apiVersionValidation,
  idempotencyValidation,
  validationHelpers,
  formatValidationError,
  validationSummary
};