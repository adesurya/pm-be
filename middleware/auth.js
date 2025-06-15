// middleware/auth.js
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * JWT Token verification middleware
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header is required',
        code: 'NO_AUTH_HEADER'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format. Use: Bearer <token>',
        code: 'INVALID_AUTH_FORMAT'
      });
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token is required',
        code: 'NO_TOKEN'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token has required fields
    if (!decoded.userId || !decoded.tenantId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload',
        code: 'INVALID_TOKEN_PAYLOAD'
      });
    }

    // Check token expiration
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Verify tenant matches request
    if (req.tenantId && decoded.tenantId !== req.tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Token tenant mismatch',
        code: 'TENANT_MISMATCH'
      });
    }

    // Store user info in request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId
    };

    logger.debug(`User authenticated: ${decoded.email} (${decoded.role})`);
    next();

  } catch (error) {
    logger.error('Token verification error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Load user details from database
 */
const loadUser = async (req, res, next) => {
  try {
    if (!req.user || !req.models) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    const user = await req.models.User.findByPk(req.user.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (!user.isActive()) {
      return res.status(403).json({
        success: false,
        message: 'User account is not active',
        code: 'USER_INACTIVE'
      });
    }

    // Store full user object
    req.currentUser = user;

    // Update last login info
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    user.login_count += 1;
    await user.save();

    next();

  } catch (error) {
    logger.error('Error loading user:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading user data'
    });
  }
};

/**
 * Role-based authorization middleware
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.currentUser.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`Access denied for user ${req.currentUser.email} with role ${userRole}. Required roles: ${allowedRoles.join(', ')}`);
      
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 */
const requirePermission = (resource, action = 'read') => {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const user = req.currentUser;
    let hasPermission = false;

    switch (action) {
      case 'read':
        hasPermission = user.canEdit(resource) || user.role === 'contributor';
        break;
      case 'create':
      case 'update':
        hasPermission = user.canEdit(resource);
        break;
      case 'delete':
        hasPermission = user.canDelete(resource);
        break;
      case 'publish':
        hasPermission = user.canPublish();
        break;
    }

    if (!hasPermission) {
      logger.warn(`Permission denied for user ${user.email} (${user.role}) on ${resource}:${action}`);
      
      return res.status(403).json({
        success: false,
        message: `You don't have permission to ${action} ${resource}`,
        code: 'PERMISSION_DENIED'
      });
    }

    next();
  };
};

/**
 * Resource ownership check middleware
 */
const requireOwnership = (resourceModel, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      if (!req.currentUser || !req.models) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const resourceId = req.params[resourceIdParam];
      const user = req.currentUser;

      // Super admin and admin can access all resources
      if (['super_admin', 'admin'].includes(user.role)) {
        return next();
      }

      // Find the resource
      const resource = await req.models[resourceModel].findByPk(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: `${resourceModel} not found`
        });
      }

      // Check ownership based on resource type
      let isOwner = false;
      
      if (resource.author_id) {
        isOwner = resource.author_id === user.id;
      } else if (resource.user_id) {
        isOwner = resource.user_id === user.id;
      } else if (resource.created_by) {
        isOwner = resource.created_by === user.id;
      }

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You can only access your own resources',
          code: 'NOT_OWNER'
        });
      }

      // Store resource in request for use in controller
      req.resource = resource;
      next();

    } catch (error) {
      logger.error('Error checking resource ownership:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking permissions'
      });
    }
  };
};

/**
 * Optional authentication middleware
 * Loads user if token is present but doesn't require authentication
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.userId && decoded.tenantId) {
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          tenantId: decoded.tenantId
        };

        // Load full user if models are available
        if (req.models) {
          const user = await req.models.User.findByPk(decoded.userId);
          if (user && user.isActive()) {
            req.currentUser = user;
          }
        }
      }
    } catch (tokenError) {
      // Ignore token errors for optional auth
      logger.debug('Optional auth token error:', tokenError.message);
    }

    next();

  } catch (error) {
    logger.error('Optional auth error:', error);
    next(); // Continue even if there's an error
  }
};

/**
 * API Key authentication middleware (for external integrations)
 */
const verifyApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key is required',
        code: 'NO_API_KEY'
      });
    }

    // In a real implementation, you would validate the API key against your database
    // For now, we'll use a simple check against environment variable
    const validApiKey = process.env.API_KEY || 'your-secret-api-key';
    
    if (apiKey !== validApiKey) {
      logger.warn(`Invalid API key attempt from IP: ${req.ip}`);
      
      return res.status(401).json({
        success: false,
        message: 'Invalid API key',
        code: 'INVALID_API_KEY'
      });
    }

    // Mark request as API authenticated
    req.isApiRequest = true;
    
    next();

  } catch (error) {
    logger.error('API key verification error:', error);
    res.status(500).json({
      success: false,
      message: 'API authentication error'
    });
  }
};

/**
 * Session-based authentication middleware (for web interface)
 */
const requireSession = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Session authentication required',
      code: 'NO_SESSION'
    });
  }

  // Store user info from session
  req.user = {
    id: req.session.userId,
    email: req.session.userEmail,
    role: req.session.userRole,
    tenantId: req.session.tenantId
  };

  next();
};

/**
 * Combined authentication middleware
 * Supports both JWT and session authentication
 */
const authenticate = [verifyToken, loadUser];

/**
 * Admin authentication (super_admin or admin roles)
 */
const requireAdmin = [
  ...authenticate,
  requireRole(['super_admin', 'admin'])
];

/**
 * Editor authentication (super_admin, admin, or editor roles)
 */
const requireEditor = [
  ...authenticate,
  requireRole(['super_admin', 'admin', 'editor'])
];

/**
 * Any authenticated user
 */
const requireAuth = authenticate;

module.exports = {
  verifyToken,
  loadUser,
  requireRole,
  requirePermission,
  requireOwnership,
  optionalAuth,
  verifyApiKey,
  requireSession,
  authenticate,
  requireAdmin,
  requireEditor,
  requireAuth
};