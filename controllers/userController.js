// controllers/userController.js
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sanitizeHtmlContent } = require('../middleware/security');

/**
 * Get all users with pagination and filters
 */
const getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    // Build where clause
    const where = {};
    
    if (role) {
      where.role = role;
    }
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where[Op.or] = [
        { first_name: { [Op.like]: `%${search}%` } },
        { last_name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: users } = await req.models.User.findAndCountAll({
      where,
      attributes: { exclude: ['password', 'email_verification_token', 'password_reset_token'] },
      order: [['created_at', 'DESC']],
      limit: pageLimit,
      offset
    });

    const totalPages = Math.ceil(count / pageLimit);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: count,
          items_per_page: pageLimit,
          has_next_page: page < totalPages,
          has_prev_page: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

/**
 * Get user statistics
 */
const getUserStats = async (req, res) => {
  try {
    const [totalUsers, activeUsers, roleCounts, recentUsers] = await Promise.all([
      req.models.User.count(),
      req.models.User.count({ where: { status: 'active' } }),
      req.models.User.findAll({
        attributes: ['role', [req.db.fn('COUNT', req.db.col('id')), 'count']],
        group: ['role']
      }),
      req.models.User.count({
        where: {
          created_at: {
            [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        }
      })
    ]);

    const roleStats = roleCounts.reduce((acc, item) => {
      acc[item.role] = parseInt(item.get('count'));
      return acc;
    }, {});

    const stats = {
      total_users: totalUsers,
      active_users: activeUsers,
      inactive_users: totalUsers - activeUsers,
      role_distribution: roleStats,
      recent_registrations: recentUsers,
      tenant_limits: {
        current: totalUsers,
        maximum: req.tenant.limits.max_users,
        percentage: Math.round((totalUsers / req.tenant.limits.max_users) * 100)
      }
    };

    res.json({
      success: true,
      data: {
        statistics: stats
      }
    });

  } catch (error) {
    logger.error('Get user statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user statistics'
    });
  }
};

/**
 * Get single user by ID
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.currentUser;

    // Check permissions: admin can view any user, others can only view themselves
    if (!['super_admin', 'admin'].includes(currentUser.role) && currentUser.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own profile',
        code: 'ACCESS_DENIED'
      });
    }

    const user = await req.models.User.findByPk(userId, {
      attributes: { exclude: ['password', 'email_verification_token', 'password_reset_token'] }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        user
      }
    });

  } catch (error) {
    logger.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
};

/**
 * Create new user
 */
const createUser = async (req, res) => {
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
      role,
      bio,
      phone
    } = req.body;

    // Check if email already exists
    const existingUser = await req.models.User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
        code: 'EMAIL_EXISTS'
      });
    }

    // Check user limit
    const userCount = await req.models.User.getActiveCount();
    if (!req.tenant.canCreateUser(userCount)) {
      return res.status(402).json({
        success: false,
        message: `User limit exceeded. Maximum allowed: ${req.tenant.limits.max_users}`,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Sanitize data
    const userData = {
      email: email.toLowerCase().trim(),
      password,
      first_name: sanitizeHtmlContent(first_name).trim(),
      last_name: sanitizeHtmlContent(last_name).trim(),
      role,
      bio: bio ? sanitizeHtmlContent(bio) : null,
      phone: phone ? phone.trim() : null,
      status: 'active',
      email_verified: true // Admin-created users are pre-verified
    };

    // Create user
    const user = await req.models.User.create(userData);

    logger.info(`User created: ${user.email} by ${req.currentUser.email}`);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    logger.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
};

/**
 * Update user
 */
const updateUser = async (req, res) => {
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

    const userId = req.params.id;
    const currentUser = req.currentUser;

    const user = await req.models.User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check permissions
    const canEdit = currentUser.id === userId || ['super_admin', 'admin'].includes(currentUser.role);
    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own profile',
        code: 'ACCESS_DENIED'
      });
    }

    const {
      email,
      first_name,
      last_name,
      role,
      status,
      bio,
      phone,
      timezone,
      language
    } = req.body;

    // Check for email conflicts (excluding current user)
    if (email && email !== user.email) {
      const existingUser = await req.models.User.findOne({
        where: {
          email: email.toLowerCase().trim(),
          id: { [Op.ne]: userId }
        }
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email already in use',
          code: 'EMAIL_EXISTS'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (email !== undefined) updateData.email = email.toLowerCase().trim();
    if (first_name !== undefined) updateData.first_name = sanitizeHtmlContent(first_name).trim();
    if (last_name !== undefined) updateData.last_name = sanitizeHtmlContent(last_name).trim();
    if (bio !== undefined) updateData.bio = bio ? sanitizeHtmlContent(bio) : null;
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (language !== undefined) updateData.language = language;

    // Only admins can change role and status
    if (['super_admin', 'admin'].includes(currentUser.role)) {
      if (role !== undefined) {
        // Prevent role escalation (non-super-admin cannot create super-admin)
        if (role === 'super_admin' && currentUser.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            message: 'Only super admins can assign super admin role',
            code: 'ROLE_ESCALATION_DENIED'
          });
        }
        updateData.role = role;
      }
      if (status !== undefined) updateData.status = status;
    }

    // Update user
    await user.update(updateData);

    logger.info(`User updated: ${user.email} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

/**
 * Delete user
 */
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.currentUser;

    const user = await req.models.User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Prevent self-deletion
    if (user.id === currentUser.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account',
        code: 'SELF_DELETE_DENIED'
      });
    }

    // Prevent deletion of super admin by non-super admin
    if (user.role === 'super_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can delete super admin accounts',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Check if user has content
    const articleCount = await req.models.News.count({ where: { author_id: userId } });
    if (articleCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete user with ${articleCount} articles. Please reassign or delete articles first.`,
        code: 'USER_HAS_CONTENT'
      });
    }

    const userEmail = user.email;

    // Delete user
    await user.destroy();

    logger.info(`User deleted: ${userEmail} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

/**
 * Change user status
 */
const changeUserStatus = async (req, res) => {
  try {
    const userId = req.params.id;
    const { status } = req.body;
    const currentUser = req.currentUser;

    const user = await req.models.User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Prevent changing own status
    if (user.id === currentUser.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own status',
        code: 'SELF_STATUS_CHANGE_DENIED'
      });
    }

    // Prevent status change of super admin by non-super admin
    if (user.role === 'super_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can change super admin status',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    await user.update({ status });

    logger.info(`User status changed: ${user.email} to ${status} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: `User status changed to ${status}`,
      data: {
        user: user.toJSON()
      }
    });

  } catch (error) {
    logger.error('Change user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change user status'
    });
  }
};

/**
 * Reset user password (Admin only)
 */
const resetUserPassword = async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.currentUser;

    const user = await req.models.User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Prevent resetting super admin password by non-super admin
    if (user.role === 'super_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can reset super admin passwords',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Generate temporary password
    const tempPassword = generateTempPassword();

    // Update user password
    await user.update({ password: tempPassword });

    // TODO: Send email with temporary password
    // await sendPasswordResetEmail(user.email, tempPassword);

    logger.info(`Password reset for user: ${user.email} by ${req.currentUser.email}`);

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        temp_password: tempPassword,
        note: 'User should change password after first login'
      }
    });

  } catch (error) {
    logger.error('Reset user password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset user password'
    });
  }
};

/**
 * Helper function to generate temporary password
 */
const generateTempPassword = () => {
  const length = 12;
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
};

module.exports = {
  getAllUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  changeUserStatus,
  resetUserPassword
};