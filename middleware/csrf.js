// middleware/csrf.js
const csrf = require('csurf');
const logger = require('../utils/logger');

/**
 * CSRF Protection Configuration
 */
const csrfProtection = csrf({
  cookie: {
    key: '_csrf',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000 // 1 hour
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  value: (req) => {
    // Check multiple possible locations for CSRF token
    return req.body._csrf ||
           req.query._csrf ||
           req.headers['csrf-token'] ||
           req.headers['xsrf-token'] ||
           req.headers['x-csrf-token'] ||
           req.headers['x-xsrf-token'];
  }
});

/**
 * CSRF token provider middleware
 * Adds CSRF token to response for API endpoints
 */
const provideCsrfToken = (req, res, next) => {
  try {
    // Generate CSRF token
    const token = req.csrfToken();
    
    // Add token to response headers
    res.set('X-CSRF-Token', token);
    
    // Add token to response locals for templates
    res.locals.csrfToken = token;
    
    // Store token in request for controllers to use
    req.csrfToken = token;
    
    next();
  } catch (error) {
    logger.error('Error generating CSRF token:', error);
    res.status(500).json({
      success: false,
      message: 'Security token generation failed'
    });
  }
};

/**
 * Custom CSRF error handler
 */
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    logger.warn('CSRF token validation failed', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    return res.status(403).json({
      success: false,
      message: 'Invalid security token',
      code: 'INVALID_CSRF_TOKEN'
    });
  }
  
  next(err);
};

/**
 * Double Submit Cookie CSRF Protection (Alternative approach)
 * Useful for API-first applications
 */
const doubleSubmitCookie = {
  // Generate and set CSRF token in cookie
  generate: (req, res, next) => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    
    // Set in cookie
    res.cookie('csrf-token', token, {
      httpOnly: false, // Client needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000 // 1 hour
    });
    
    // Also set in header for immediate use
    res.set('X-CSRF-Token', token);
    
    next();
  },
  
  // Validate CSRF token
  validate: (req, res, next) => {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    
    const cookieToken = req.cookies['csrf-token'];
    const headerToken = req.headers['x-csrf-token'] || 
                       req.headers['csrf-token'] ||
                       req.body._csrf ||
                       req.query._csrf;
    
    if (!cookieToken || !headerToken) {
      logger.warn('Missing CSRF tokens', {
        ip: req.ip,
        url: req.url,
        method: req.method,
        hasCookie: !!cookieToken,
        hasHeader: !!headerToken
      });
      
      return res.status(403).json({
        success: false,
        message: 'CSRF token required',
        code: 'CSRF_TOKEN_REQUIRED'
      });
    }
    
    if (cookieToken !== headerToken) {
      logger.warn('CSRF token mismatch', {
        ip: req.ip,
        url: req.url,
        method: req.method
      });
      
      return res.status(403).json({
        success: false,
        message: 'Invalid CSRF token',
        code: 'INVALID_CSRF_TOKEN'
      });
    }
    
    next();
  }
};

/**
 * Conditional CSRF protection
 * Apply CSRF protection based on request type
 */
const conditionalCsrf = (req, res, next) => {
  // Skip CSRF for API requests with valid API key/token
  if (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')) {
    return next();
  }
  
  // Skip for webhook endpoints
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }
  
  // Apply CSRF protection for web requests
  return csrfProtection(req, res, next);
};

/**
 * CSRF token endpoint
 * Provides CSRF token for SPA applications
 */
const csrfTokenEndpoint = (req, res) => {
  try {
    const token = req.csrfToken();
    
    res.json({
      success: true,
      csrfToken: token
    });
  } catch (error) {
    logger.error('Error providing CSRF token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CSRF token'
    });
  }
};

/**
 * CSRF protection for different application types
 */
const csrfForWebApp = [csrfProtection, provideCsrfToken];
const csrfForAPI = [doubleSubmitCookie.generate, doubleSubmitCookie.validate];
const csrfForSPA = [conditionalCsrf, provideCsrfToken];

module.exports = {
  csrfProtection,
  provideCsrfToken,
  csrfErrorHandler,
  doubleSubmitCookie,
  conditionalCsrf,
  csrfTokenEndpoint,
  csrfForWebApp,
  csrfForAPI,
  csrfForSPA
};