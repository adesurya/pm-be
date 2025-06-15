// middleware/upload.js
const uploadService = require('../services/uploadService');
const logger = require('../utils/logger');

/**
 * Middleware for handling single image upload
 */
const uploadSingleImage = (uploadType = 'articles') => {
  return (req, res, next) => {
    const upload = uploadService.getMulterConfig(req.tenantId, uploadType);
    
    upload.single('image')(req, res, (err) => {
      if (err) {
        logger.error('Upload middleware error:', err);
        
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File too large. Maximum size is 10MB',
            code: 'FILE_TOO_LARGE'
          });
        }
        
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected field name. Use "image" field',
            code: 'UNEXPECTED_FIELD'
          });
        }
        
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
          code: 'UPLOAD_ERROR'
        });
      }
      
      next();
    });
  };
};

/**
 * Middleware for handling multiple image uploads
 */
const uploadMultipleImages = (uploadType = 'articles', maxCount = 5) => {
  return (req, res, next) => {
    const upload = uploadService.getMulterConfig(req.tenantId, uploadType);
    
    upload.array('images', maxCount)(req, res, (err) => {
      if (err) {
        logger.error('Multiple upload middleware error:', err);
        
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'One or more files too large. Maximum size is 10MB per file',
            code: 'FILE_TOO_LARGE'
          });
        }
        
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            message: `Too many files. Maximum ${maxCount} files allowed`,
            code: 'TOO_MANY_FILES'
          });
        }
        
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
          code: 'UPLOAD_ERROR'
        });
      }
      
      next();
    });
  };
};

/**
 * Middleware for handling mixed form data with files
 */
const uploadMixedForm = (uploadType = 'articles') => {
  return (req, res, next) => {
    const upload = uploadService.getMulterConfig(req.tenantId, uploadType);
    
    upload.fields([
      { name: 'featured_image', maxCount: 1 },
      { name: 'gallery_images', maxCount: 10 },
      { name: 'thumbnail', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        logger.error('Mixed form upload error:', err);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
          code: 'UPLOAD_ERROR'
        });
      }
      
      next();
    });
  };
};

module.exports = {
  uploadSingleImage,
  uploadMultipleImages,
  uploadMixedForm
};

