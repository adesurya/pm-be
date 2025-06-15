// ================================
// routes/upload.js - New upload routes
// ================================

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { uploadSingleImage, uploadMultipleImages } = require('../middleware/upload');
const uploadService = require('../services/uploadService');
const cacheService = require('../config/cache');
const logger = require('../utils/logger');

/**
 * Upload single image (general purpose)
 */
router.post('/image/:type',
  requireAuth,
  requirePermission('content', 'create'),
  (req, res, next) => {
    const uploadType = req.params.type;
    const allowedTypes = ['articles', 'avatars', 'categories', 'logos'];
    
    if (!allowedTypes.includes(uploadType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid upload type',
        allowed_types: allowedTypes
      });
    }
    
    req.uploadType = uploadType;
    next();
  },
  uploadSingleImage(),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided',
          code: 'NO_FILE'
        });
      }

      const result = await uploadService.processAndSaveImage(
        req.file.buffer,
        req.tenantId,
        req.uploadType,
        true // Generate multiple sizes
      );

      // Generate URLs for all sizes
      const imageUrls = uploadService.getImageUrls(
        req.tenantId,
        req.uploadType,
        result
      );

      logger.info(`Image uploaded successfully: ${result.id} by ${req.currentUser.email}`);

      res.status(201).json({
        success: true,
        message: 'Image uploaded successfully',
        data: {
          id: result.id,
          urls: imageUrls,
          metadata: result.metadata,
          upload_type: req.uploadType
        }
      });

    } catch (error) {
      logger.error('Image upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: error.message
      });
    }
  }
);

/**
 * Upload multiple images
 */
router.post('/images/:type',
  requireAuth,
  requirePermission('content', 'create'),
  (req, res, next) => {
    const uploadType = req.params.type;
    const allowedTypes = ['articles', 'gallery'];
    
    if (!allowedTypes.includes(uploadType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid upload type for multiple images',
        allowed_types: allowedTypes
      });
    }
    
    req.uploadType = uploadType;
    next();
  },
  uploadMultipleImages(),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No image files provided',
          code: 'NO_FILES'
        });
      }

      const results = await uploadService.processMultipleImages(
        req.files,
        req.tenantId,
        req.uploadType
      );

      // Process successful uploads
      const successfulUploads = results.results.map(result => {
        if (result.success) {
          return {
            ...result,
            urls: uploadService.getImageUrls(
              req.tenantId,
              req.uploadType,
              result.data
            )
          };
        }
        return result;
      });

      logger.info(`Multiple images uploaded: ${results.results.length} files by ${req.currentUser.email}`);

      res.status(201).json({
        success: true,
        message: 'Images uploaded successfully',
        data: {
          successful_uploads: successfulUploads.filter(r => r.success),
          failed_uploads: results.errors,
          total_files: req.files.length,
          success_count: results.results.length,
          error_count: results.errors.length
        }
      });

    } catch (error) {
      logger.error('Multiple image upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload images',
        error: error.message
      });
    }
  }
);

/**
 * Delete uploaded image
 */
router.delete('/image/:type/:imageId',
  requireAuth,
  requirePermission('content', 'delete'),
  async (req, res) => {
    try {
      const { type: uploadType, imageId } = req.params;
      
      const deleted = await uploadService.deleteImage(
        req.tenantId,
        imageId,
        uploadType
      );

      if (deleted) {
        logger.info(`Image deleted: ${imageId} by ${req.currentUser.email}`);
        
        res.json({
          success: true,
          message: 'Image deleted successfully'
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Image not found or already deleted'
        });
      }

    } catch (error) {
      logger.error('Image deletion error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete image'
      });
    }
  }
);

/**
 * Get tenant storage usage
 */
router.get('/storage/usage',
  requireAuth,
  requirePermission('content', 'read'),
  async (req, res) => {
    try {
      const usage = await uploadService.getTenantStorageUsage(req.tenantId);
      
      res.json({
        success: true,
        data: usage
      });

    } catch (error) {
      logger.error('Storage usage error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get storage usage'
      });
    }
  }
);

/**
 * Cleanup temporary files
 */
router.post('/cleanup/temp',
  requireAuth,
  requirePermission('content', 'delete'),
  async (req, res) => {
    try {
      const { older_than_hours = 24 } = req.body;
      const olderThan = parseInt(older_than_hours) * 60 * 60 * 1000;
      
      const deletedCount = await uploadService.cleanupTempFiles(req.tenantId, olderThan);
      
      res.json({
        success: true,
        message: 'Temporary files cleaned up',
        data: {
          deleted_files: deletedCount,
          older_than_hours: parseInt(older_than_hours)
        }
      });

    } catch (error) {
      logger.error('Temp cleanup error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cleanup temporary files'
      });
    }
  }
);

module.exports = router;