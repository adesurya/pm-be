// middleware/csrf.js
const crypto = require('crypto');

/**
 * Simple CSRF token provider middleware
 * Adds CSRF token to response for API endpoints
 */
const provideCsrfToken = (req, res, next) => {
  try {
    // Generate simple CSRF token for development
    const token = crypto.randomBytes(32).toString('hex');
    
    // Add token to response headers
    res.set('X-CSRF-Token', token);
    
    // Add token to response locals for templates
    res.locals.csrfToken = token;
    
    // Store token in request for controllers to use
    req.csrfToken = token;
    
    next();
  } catch (error) {
    console.error('Error generating CSRF token:', error);
    res.status(500).json({
      success: false,
      message: 'Security token generation failed'
    });
  }
};

/**
 * CSRF token endpoint
 * Provides CSRF token for SPA applications
 */
const csrfTokenEndpoint = (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    
    res.json({
      success: true,
      csrfToken: token,
      message: 'CSRF token generated'
    });
  } catch (error) {
    console.error('Error providing CSRF token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CSRF token'
    });
  }
};

/**
 * Simple CSRF validation middleware
 */
const validateCsrfToken = (req, res, next) => {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Skip CSRF validation in development
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  const token = req.headers['x-csrf-token'] || 
                req.headers['csrf-token'] ||
                req.body._csrf ||
                req.query._csrf;
  
  if (!token) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token required',
      code: 'CSRF_TOKEN_REQUIRED'
    });
  }
  
  // In a real implementation, you would validate against stored token
  // For now, we just check if token exists and has correct format
  if (typeof token !== 'string' || token.length < 32) {
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
      code: 'INVALID_CSRF_TOKEN'
    });
  }
  
  next();
};

/**
 * Double Submit Cookie CSRF Protection (Alternative approach)
 */
const doubleSubmitCookie = {
  // Generate and set CSRF token in cookie
  generate: (req, res, next) => {
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
    
    // Skip in development
    if (process.env.NODE_ENV === 'development') {
      return next();
    }
    
    const cookieToken = req.cookies['csrf-token'];
    const headerToken = req.headers['x-csrf-token'] || 
                       req.headers['csrf-token'] ||
                       req.body._csrf ||
                       req.query._csrf;
    
    if (!cookieToken || !headerToken) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token required',
        code: 'CSRF_TOKEN_REQUIRED'
      });
    }
    
    if (cookieToken !== headerToken) {
      return res.status(403).json({
        success: false,
        message: 'Invalid CSRF token',
        code: 'INVALID_CSRF_TOKEN'
      });
    }
    
    next();
  }
};

module.exports = {
  provideCsrfToken,
  csrfTokenEndpoint,
  validateCsrfToken,
  doubleSubmitCookie
};