// routes/tenants.js
const express = require('express');
const router = express.Router();

// Import middleware
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * @route   GET /api/tenants/info
 * @desc    Get current tenant information
 * @access  Private
 */
router.get('/info', requireAuth, async (req, res) => {
  try {
    const tenant = req.tenant;
    
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant context not found',
        code: 'NO_TENANT_CONTEXT'
      });
    }

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          domain: tenant.domain,
          plan: tenant.plan,
          status: tenant.status,
          settings: tenant.settings,
          limits: tenant.limits,
          created_at: tenant.created_at
        }
      }
    });

  } catch (error) {
    console.error('Get tenant info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tenant information'
    });
  }
});

/**
 * @route   PUT /api/tenants/settings
 * @desc    Update tenant settings (Admin only)
 * @access  Private (Admin+)
 */
router.put('/settings', 
  requireAuth,
  requireRole(['super_admin', 'admin']),
  async (req, res) => {
    try {
      const tenant = req.tenant;
      const { settings } = req.body;

      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Tenant context not found',
          code: 'NO_TENANT_CONTEXT'
        });
      }

      // Merge with existing settings
      const updatedSettings = {
        ...tenant.settings,
        ...settings
      };

      // Update tenant settings
      await tenant.update({ settings: updatedSettings });

      res.json({
        success: true,
        message: 'Tenant settings updated successfully',
        data: {
          settings: updatedSettings
        }
      });

    } catch (error) {
      console.error('Update tenant settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update tenant settings'
      });
    }
  }
);

/**
 * @route   GET /api/tenants/stats
 * @desc    Get tenant usage statistics (Admin only)
 * @access  Private (Admin+)
 */
router.get('/stats',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  async (req, res) => {
    try {
      const tenant = req.tenant;

      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Tenant context not found',
          code: 'NO_TENANT_CONTEXT'
        });
      }

      // Get usage statistics
      const [userCount, articleCount, categoryCount, tagCount] = await Promise.all([
        req.models.User.count(),
        req.models.News.count(),
        req.models.Category.count(),
        req.models.Tag.count()
      ]);

      const stats = {
        usage: {
          users: userCount,
          articles: articleCount,
          categories: categoryCount,
          tags: tagCount
        },
        limits: tenant.limits,
        usage_percentage: {
          users: Math.round((userCount / tenant.limits.max_users) * 100),
          articles: Math.round((articleCount / tenant.limits.max_articles) * 100),
          categories: Math.round((categoryCount / tenant.limits.max_categories) * 100),
          tags: Math.round((tagCount / tenant.limits.max_tags) * 100)
        },
        plan_info: {
          current_plan: tenant.plan,
          status: tenant.status
        }
      };

      res.json({
        success: true,
        data: {
          statistics: stats
        }
      });

    } catch (error) {
      console.error('Get tenant stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch tenant statistics'
      });
    }
  }
);

/**
 * @route   GET /api/tenants/health
 * @desc    Get tenant health status
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const tenant = req.tenant;
    
    const health = {
      tenant_status: tenant ? 'identified' : 'not_identified',
      database_status: 'unknown',
      timestamp: new Date().toISOString()
    };

    if (tenant) {
      health.tenant_info = {
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        status: tenant.status
      };

      // Test database connection
      try {
        await req.db.authenticate();
        health.database_status = 'connected';
      } catch (error) {
        health.database_status = 'failed';
        health.database_error = error.message;
      }
    }

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    console.error('Tenant health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

module.exports = router;