// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const { sanitizeHtmlContent } = require('../middleware/security');

/**
 * Generate JWT tokens
 */
const generateTokens = (user, tenantId) => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: tenantId
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d'
  });

  return { accessToken, refreshToken };
};

/**
 * User registration
 */
const register = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { 
      email, 
      password, 
      first_name, 
      last_name, 
      role = 'contributor' 
    } = req.body;

    // Sanitize input
    const sanitizedData = {
      email: email.toLowerCase().trim(),
      first_name: sanitizeHtmlContent(first_name).trim(),
      last_name: sanitizeHtmlContent(last_name).trim(),
      role: ['super_admin', 'admin', 'editor', 'contributor'].includes(role) ? role : 'contributor'
    };

    // Check if user already exists
    const existingUser = await req.models.User.findByEmail(sanitizedData.email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
        code: 'USER_EXISTS'
      });
    }

    // Check tenant user limits
    const userCount = await req.models.User.getActiveCount();
    if (!req.tenant.canCreateUser(userCount)) {
      return res.status(402).json({
        success: false,
        message: `User limit exceeded. Maximum allowed: ${req.tenant.limits.max_users}`,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Create user
    const user = await req.models.User.create({
      ...sanitizedData,
      password,
      email_verification_token: crypto.randomBytes(32).toString('hex')
    });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user, req.tenantId);

    // Log successful registration
    logger.info(`User registered successfully: ${user.email} in tenant: ${req.tenant.name}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.toJSON(),
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: '24h'
        }
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      code: 'REGISTRATION_ERROR'
    });
  }
};

/**
 * User login
 */
const login = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await req.models.User.findByEmail(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.isActive()) {
      return res.status(403).json({
        success: false,
        message: 'User account is not active',
        code: 'USER_INACTIVE'
      });
    }

    // Verify password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Update login info
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    user.login_count += 1;
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user, req.tenantId);

    // Store session info
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    req.session.tenantId = req.tenantId;

    // Log successful login
    logger.info(`User logged in successfully: ${user.email} from IP: ${req.ip}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: '24h'
        }
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      code: 'LOGIN_ERROR'
    });
  }
};

/**
 * User logout
 */
const logout = async (req, res) => {
  try {
    // Clear session
    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destruction error:', err);
        return res.status(500).json({
          success: false,
          message: 'Logout failed'
        });
      }

      res.clearCookie('newsapp.sid');
      
      logger.info(`User logged out: ${req.currentUser?.email}`);
      
      res.json({
        success: true,
        message: 'Logout successful'
      });
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

/**
 * Refresh access token
 */
const refreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    // Find user
    const user = await req.models.User.findByPk(decoded.userId);
    if (!user || !user.isActive()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user, req.tenantId);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          access_token: accessToken,
          refresh_token: newRefreshToken,
          token_type: 'Bearer',
          expires_in: '24h'
        }
      }
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
  try {
    const user = req.currentUser;
    
    res.json({
      success: true,
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = req.currentUser;
    const { 
      first_name, 
      last_name, 
      bio, 
      phone, 
      timezone, 
      language,
      preferences 
    } = req.body;

    // Sanitize input
    const updateData = {};
    if (first_name) updateData.first_name = sanitizeHtmlContent(first_name).trim();
    if (last_name) updateData.last_name = sanitizeHtmlContent(last_name).trim();
    if (bio) updateData.bio = sanitizeHtmlContent(bio);
    if (phone) updateData.phone = phone.trim();
    if (timezone) updateData.timezone = timezone;
    if (language) updateData.language = language;
    if (preferences) updateData.preferences = preferences;

    // Update user
    await user.update(updateData);

    logger.info(`Profile updated for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * Change password
 */
const changePassword = async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = req.currentUser;
    const { current_password, new_password } = req.body;

    // Verify current password
    const isValidPassword = await user.comparePassword(current_password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
        code: 'INVALID_PASSWORD'
      });
    }

    // Update password
    await user.update({ password: new_password });

    logger.info(`Password changed for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

/**
 * Forgot password
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await req.models.User.findByEmail(email.toLowerCase().trim());
    if (!user) {
      // Don't reveal if user exists or not
      return res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await user.update({
      password_reset_token: resetToken,
      password_reset_expires: resetTokenExpires
    });

    // TODO: Send email with reset link
    // await sendPasswordResetEmail(user.email, resetToken);

    logger.info(`Password reset requested for user: ${user.email}`);

    res.json({
      success: true,
      message: 'If the email exists, a password reset link has been sent'
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
};

/**
 * Reset password
 */
const resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    const user = await req.models.User.findOne({
      where: {
        password_reset_token: token,
        password_reset_expires: {
          [req.db.Sequelize.Op.gt]: new Date()
        }
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
        code: 'INVALID_RESET_TOKEN'
      });
    }

    // Update password and clear reset token
    await user.update({
      password: new_password,
      password_reset_token: null,
      password_reset_expires: null
    });

    logger.info(`Password reset completed for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword
};